/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CapabilityReport, TaskResult } from "./capability/judge";
import { summarize } from "./capability/judge";
import {
  conditionMismatches,
  loadSweep,
  renderComparison,
  scenarioModelMismatch,
  scoreTarget,
  sweepLabels,
  sweepProblems,
  writeComparison,
} from "./compare";
import type { ScenarioRecord } from "./harness/scenario-log";

describe("conditionMismatches", () => {
  const report = (
    over: Partial<Parameters<typeof conditionMismatches>[0]> = {}
  ): Parameters<typeof conditionMismatches>[0] => ({
    mode: "stdio",
    model: "gpt-5.1",
    judgeModel: "gpt-5.1",
    ...over,
  });

  it("passes two runs held to the same model, judge and wiring", () => {
    expect(conditionMismatches(report(), report())).toEqual([]);
  });

  it("catches two halves graded by different judges", () => {
    const problems = conditionMismatches(report({ judgeModel: "gpt-4.1" }), report());
    expect(problems).toEqual([expect.stringContaining("different judges")]);
  });

  it("refuses to call an unrecorded judge a match", () => {
    const problems = conditionMismatches(report({ judgeModel: "" }), report());
    expect(problems[0]).toContain("does not name its judge");
  });

  it("catches two different models", () => {
    // The failure this exists for: a stronger model on the current half produces
    // a table indistinguishable from a successful refactor.
    const problems = conditionMismatches(report({ model: "gpt-4.1" }), report());
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("different models");
  });

  it("catches in-process scored against over-the-wire", () => {
    const problems = conditionMismatches(report({ mode: "live" }), report());
    expect(problems[0]).toContain("different tool wiring");
  });

  it("refuses to call an unrecorded model a match", () => {
    // Absence of evidence is not evidence of sameness — an older report that
    // never named its model cannot be shown to agree with anything.
    const problems = conditionMismatches(report({ model: "" }), report());
    expect(problems[0]).toContain("does not name the model");
  });

  it("catches two corpora, reading a report without one as standard", () => {
    expect(conditionMismatches(report(), report({ corpus: "standard" }))).toEqual([]);
    const problems = conditionMismatches(report(), report({ corpus: "demanding" }));
    expect(problems).toEqual([expect.stringContaining("different corpora")]);
  });

  it("catches a subset compared with the whole corpus", () => {
    const problems = conditionMismatches(report(), report({ taskFilter: ["lookup-geocode"] }));
    expect(problems).toEqual([expect.stringContaining("different tasks")]);
  });

  it("passes the same subset chosen in another order", () => {
    expect(
      conditionMismatches(report({ taskFilter: ["a", "b"] }), report({ taskFilter: ["b", "a"] }))
    ).toEqual([]);
  });

  it("catches different settings, and one report that records none", () => {
    const settings = {
      provider: "azure" as const,
      judgeProvider: "azure" as const,
      temperature: 0,
      maxSteps: 8,
      serverInstructions: true,
    };
    expect(conditionMismatches(report({ settings }), report({ settings }))).toEqual([]);
    expect(
      conditionMismatches(
        report({ settings }),
        report({ settings: { ...settings, judgeProvider: "openai", maxSteps: 12 } })
      )
    ).toEqual([
      "different judgeProvider: `azure` against `openai`",
      "different maxSteps: `8` against `12`",
    ]);
    expect(conditionMismatches(report({ settings }), report())).toEqual([
      expect.stringContaining("does not record its settings"),
    ]);
  });

  it("catches a run its token budget cut short, and passes one it did not", () => {
    const budget = { maxTokens: 1_000, spentTokens: 1_200 };
    expect(conditionMismatches(report({ budget: { ...budget, unrun: [] } }), report())).toEqual([]);
    const problems = conditionMismatches(report(), report({ budget: { ...budget, unrun: ["x"] } }));
    expect(problems).toEqual([expect.stringContaining("spent its EVAL_MAX_TOKENS budget")]);
  });
});

describe("scenarioModelMismatch", () => {
  const record = (modelId: string, over: Partial<ScenarioRecord> = {}): ScenarioRecord =>
    ({
      label: "l",
      serverRoot: "/x",
      prompt: "p",
      expectedTool: "tomtom-discover-places",
      accepted: [],
      forbidden: [],
      modelId,
      toolsCalled: [],
      hops: 1,
      passed: true,
      tokens: 1,
      ...over,
    }) as ScenarioRecord;

  it("accepts the same model list on both sides", () => {
    expect(scenarioModelMismatch([record("gpt-5.1")], [record("gpt-5.1")])).toBeUndefined();
  });

  it("reports a differing model list", () => {
    expect(scenarioModelMismatch([record("gpt-4.1")], [record("gpt-5.1")])).toContain(
      "different models"
    );
  });

  it("ignores the unrepresentable rows, which never ran a model", () => {
    // They carry an empty modelId by construction; counting it would report a
    // mismatch on every comparison that skipped a dataset tool.
    const baseline = [
      record("gpt-5.1"),
      record("", { unrepresentable: ["tomtom-analyse-datasets"] }),
    ];
    expect(scenarioModelMismatch(baseline, [record("gpt-5.1")])).toBeUndefined();
  });
});

const task = (id: string, answered: boolean, overrides: Partial<TaskResult> = {}): TaskResult => ({
  id,
  capability: "lookup",
  expected: "blocked",
  answered,
  grounded: true,
  acknowledgedLimit: false,
  madeClaims: answered,
  reason: "",
  judgedOnCompleteData: true,
  toolsCalled: ["tomtom-plan-route"],
  tokens: 1_000,
  toolFriction: [],
  ...overrides,
});

/** A run whose tasks answered as `answered` says, by id. */
const run = (
  answered: Record<string, boolean>,
  overrides: Partial<CapabilityReport> = {}
): CapabilityReport => {
  const results = Object.entries(answered).map(([id, value]) => task(id, value));
  return {
    generatedAt: "2026-11-04T00:00:00.000Z",
    mode: "stdio",
    target: { label: "t", root: ".", baseline: false },
    model: "gpt-5.1",
    judgeModel: "gpt-4.1",
    settings: {
      provider: "azure",
      judgeProvider: "azure",
      temperature: 0,
      maxSteps: 8,
      serverInstructions: true,
    },
    corpus: "standard",
    summary: summarize(results),
    results,
    ...overrides,
  };
};

describe("a sweep's comparison", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const sweep = (files: Record<string, unknown>): string => {
    const created = mkdtempSync(join(tmpdir(), "eval-sweep-"));
    dir = created;
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(
        join(created, name),
        typeof content === "string" ? content : JSON.stringify(content)
      );
    }
    return created;
  };

  it("finds its targets in the manifest's order, else in natural order", () => {
    const files = {
      "report.phase10.1.json": run({ a: true }),
      "report.phase2.1.json": run({ a: true }),
      "report.standard.main.gpt-4.1.1.json": run({ a: true }),
      "runs.phase2.jsonl": "",
    };
    expect(sweepLabels(sweep(files))).toEqual(["phase2", "phase10", "standard.main.gpt-4.1"]);
    const ordered = sweep({
      ...files,
      "sweep.json": { targets: [{ label: "phase10" }, { label: "phase2" }] },
    });
    expect(sweepLabels(ordered)).toEqual(["phase10", "phase2"]);
  });

  it("takes each metric's median and range over a target's runs", () => {
    const score = scoreTarget({
      label: "current",
      reports: [run({ a: true, b: true }), run({ a: true, b: false }), run({ a: false, b: false })],
      scenarios: [],
    });
    expect(score.capability.answered).toMatchObject({ min: 0, median: 1, max: 2 });
    expect(score.perTask.a).toEqual({ answered: 2, grounded: 3, of: 3, expected: "blocked" });
    expect(score.judge).toBe("azure/gpt-4.1");
    expect(score.selfJudged).toBe(false);
  });

  it("names the judge of every capability column, and flags a model that judged itself", () => {
    const targets = loadSweep(
      sweep({
        "report.gpt-5.1.1.json": run({ a: true }),
        "report.gpt-5.1.2.json": run({ a: false }),
        "report.gpt-4.1.1.json": run({ a: true }, { model: "gpt-4.1" }),
      }),
      ["gpt-5.1", "gpt-4.1"]
    );
    const markdown = renderComparison("/sweep", targets, []);
    expect(markdown).toContain("| judged by | azure/gpt-4.1 | azure/gpt-4.1 ⚠ self-judged |");
    expect(markdown).toContain("| answered | 0.5 (0–1) | 1 |");
    expect(markdown).toContain("| a | blocked | 1/2 · 2/2 | 1/1 · 1/1 |");
    expect(markdown).toContain("⚠ self-judged: the model under test graded its own answers");
  });

  it("refuses runs held to other conditions, and runs that left tasks unscored", () => {
    const targets = loadSweep(
      sweep({
        "report.baseline.1.json": run({ a: true }),
        "report.current.1.json": run({ a: true }, { judgeModel: "claude-opus-5" }),
        "report.current.2.json": run(
          {},
          {
            summary: { ...summarize([task("a", true, { error: "aborted" })]) },
          }
        ),
      })
    );
    expect(sweepProblems(targets)).toEqual([
      "current run 1 against baseline run 1: different judges: `gpt-4.1` against `claude-opus-5`",
      "current run 2 did not score 1 task(s), so it covers fewer tasks",
    ]);
  });

  it("scores tool selection on first attempts, with the legacy surface's footnote", () => {
    const record = (overrides: Partial<ScenarioRecord>): string =>
      JSON.stringify({
        label: "l",
        serverRoot: ".",
        prompt: "p",
        expectedTool: "tomtom-discover-places",
        accepted: [],
        forbidden: [],
        modelId: "gpt-5.1",
        toolsCalled: ["tomtom-discover-places"],
        hops: 1,
        passed: true,
        tokens: 10,
        ...overrides,
      });
    const created = sweep({
      "runs.baseline.jsonl": `${record({ surface: "legacy", hops: 3 })}\n`,
      "runs.current.jsonl": `${[record({ passed: false }), record({})].join("\n")}\n`,
    });
    const { markdown, problems } = writeComparison(created);
    const written = readFileSync(markdown, "utf-8");
    expect(problems).toEqual([]);
    expect(written).toContain("| accuracy | 100.0%† | 0.0% |");
    expect(written).toContain("| flaky: failed first, passed a retry | 0 | 1 |");
    expect(written).toContain(
      "† The legacy surface is scored with the order and argument checks off"
    );
    expect(written).toContain("### Prompts whose hop count moved, baseline to current");
    expect(JSON.parse(readFileSync(join(created, "results.json"), "utf-8")).targets).toHaveLength(
      2
    );
  });
});
