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
 *
 * The before/after machinery, tested without a model key.
 *
 * Everything the comparison depends on that is NOT a model call lives here:
 * which checkout gets spawned, where its artefact lands, and how an expectation
 * written against today's tools is replayed against yesterday's. A silent fault
 * in any of it produces a comparison that looks fine and means nothing — the
 * worst failure mode this exercise has — and none of it needs credentials, so
 * it can be asserted for free.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_TOOLS } from "../../src/tools/tool-registry";
import { conditionMismatches, scenarioModelMismatch } from "../compare";
import { willRunScenarios } from "./global-setup";
import {
  finalAttempts,
  readScenarioLog,
  type ScenarioRecord,
  summarizeScenarios,
} from "./scenario-log";
import { LEGACY_EQUIVALENTS, LEGACY_TOOL_NAMES, toLegacyExpectation } from "./surfaces";
import { artefactPath, assertTransportForTarget, REPO_ROOT, resolveTarget } from "./target";

describe("resolveTarget", () => {
  it("defaults to this checkout, with the stable unlabelled artefact name", () => {
    const target = resolveTarget({});
    expect(target.root).toBe(REPO_ROOT);
    expect(target.isBaseline).toBe(false);
    // `report.json` unchanged is what keeps the existing phase-to-phase git diff
    // working; a comparison must not rename the file everyone already tracks.
    expect(artefactPath("/x", "report", "json", target)).toBe(join("/x", "report.json"));
  });

  it("resolves a relative EVAL_SERVER_ROOT against the repo, not the cwd", () => {
    // "." is the repo itself — the one relative path guaranteed to exist.
    const target = resolveTarget({ EVAL_SERVER_ROOT: "." });
    expect(target.root).toBe(REPO_ROOT);
    // Same tree, so NOT a baseline: pointing the flag at yourself must not
    // silently disable the assertions the suite exists to make.
    expect(target.isBaseline).toBe(false);
  });

  it("rejects a checkout with no server entry point, naming the path", () => {
    const empty = mkdtempSync(join(tmpdir(), "eval-target-"));
    try {
      expect(() => resolveTarget({ EVAL_SERVER_ROOT: empty })).toThrow(/bin\/tomtom-mcp\.js/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("labels artefacts so two runs cannot overwrite each other", () => {
    const target = resolveTarget({ EVAL_SERVER_ROOT: ".", EVAL_LABEL: "baseline" });
    expect(artefactPath("/x", "report", "json", target)).toBe(join("/x", "report.baseline.json"));
    expect(artefactPath("/x", "runs", "jsonl", target)).toBe(join("/x", "runs.baseline.jsonl"));
  });
});

describe("assertTransportForTarget", () => {
  const baseline = { root: "/elsewhere", label: "baseline", isBaseline: true };

  it("refuses an in-process baseline run", () => {
    // The failure this prevents is the quiet one: in-process tools come from
    // THIS registry, so the run would score the new surface under the old name.
    expect(() => assertTransportForTarget(undefined, baseline)).toThrow(/EVAL_TRANSPORT=stdio/);
  });

  it("allows a baseline over the transport, and this tree either way", () => {
    expect(() => assertTransportForTarget("stdio", baseline)).not.toThrow();
    expect(() => assertTransportForTarget(undefined, resolveTarget({}))).not.toThrow();
  });
});

describe("LEGACY_EQUIVALENTS", () => {
  it("maps every model-visible tool, so no scenario is scored against nothing", () => {
    // The drift guard. A tool added to the registry without a row here would
    // silently become "unrepresentable" on the baseline and vanish from the
    // denominator — an improvement, on paper, made of a missing map entry.
    const mapped = Object.keys(LEGACY_EQUIVALENTS).sort();
    expect(mapped).toEqual(DEFAULT_TOOLS.map((entry) => entry.name).sort());
  });

  it("lists the legacy surface the pre-consolidation server advertised", () => {
    expect(LEGACY_TOOL_NAMES).toContain("tomtom-fuzzy-search");
    expect(LEGACY_TOOL_NAMES).toContain("tomtom-ev-routing");
    // Nothing that only exists after the consolidation may appear as "legacy".
    expect(LEGACY_TOOL_NAMES).not.toContain("tomtom-discover-places");
    expect(LEGACY_TOOL_NAMES).not.toContain("tomtom-analyse-data");
  });
});

describe("toLegacyExpectation", () => {
  it("accepts any of the tools the expected one absorbed", () => {
    const translated = toLegacyExpectation({ expectedTool: "tomtom-discover-places" });
    expect(translated.accepted).toContain("tomtom-nearby");
    expect(translated.accepted).toContain("tomtom-area-search");
    expect(translated.unrepresentable).toEqual([]);
  });

  it("reports a dataset tool as unrepresentable rather than as a failure", () => {
    const translated = toLegacyExpectation({ expectedTool: "tomtom-analyse-data" });
    expect(translated.accepted).toEqual([]);
    expect(translated.unrepresentable).toEqual(["tomtom-analyse-data"]);
  });

  it("drops a prohibition that the consolidation made unsatisfiable", () => {
    // `nearby` vs `area-search` was a real near-miss to police on the old
    // surface; both now live inside discover-places. Forbidding one while
    // expecting the other cannot be evaluated there, so it is dropped and said
    // out loud rather than failing every prompt it touches.
    const translated = toLegacyExpectation({
      expectedTool: "tomtom-discover-places",
      forbiddenTools: ["tomtom-discover-places"],
    });
    expect(translated.forbidden).toEqual([]);
    expect(translated.droppedForbidden).toContain("tomtom-nearby");
  });

  it("keeps a prohibition that survives translation", () => {
    const translated = toLegacyExpectation({
      expectedTool: "tomtom-get-traffic",
      forbiddenTools: ["tomtom-dynamic-map"],
    });
    expect(translated.accepted).toEqual(["tomtom-traffic"]);
    expect(translated.forbidden).toEqual(["tomtom-dynamic-map"]);
    expect(translated.droppedForbidden).toEqual([]);
  });
});

describe("summarizeScenarios", () => {
  const record = (over: Partial<ScenarioRecord>): ScenarioRecord => ({
    label: "baseline",
    serverRoot: "/elsewhere",
    prompt: "p",
    expectedTool: "tomtom-discover-places",
    accepted: [],
    forbidden: [],
    modelId: "m",
    toolsCalled: [],
    hops: 1,
    passed: true,
    tokens: 100,
    ...over,
  });

  it("excludes unrepresentable scenarios from accuracy", () => {
    // Otherwise the new surface scores a free win on every dataset tool the old
    // one never had, which measures the rename and not the improvement.
    // Distinct prompts: same prompt + same model is ONE scenario retried, which
    // `finalAttempts` collapses by design.
    const summary = summarizeScenarios([
      record({ prompt: "a", passed: true, hops: 1 }),
      record({ prompt: "b", passed: false, hops: 3 }),
      record({ prompt: "c", unrepresentable: ["tomtom-analyse-data"], hops: 0, tokens: 0 }),
    ]);
    expect(summary.scenarios).toBe(3);
    expect(summary.evaluated).toBe(2);
    expect(summary.skippedUnrepresentable).toBe(1);
    expect(summary.accuracy).toBe(0.5);
  });

  it("counts the final attempt of a retried scenario, not every attempt", () => {
    // Scenario describes set `retry: 2`. Counting attempts would hand the WORSE
    // surface a bigger denominator — it fails more, so it retries more — which
    // silently flatters it. Observed for real: 58 baseline attempts vs 50
    // current for the same 14 prompts, before this was fixed.
    const attempts = [
      record({ prompt: "flaky", passed: false, hops: 0 }),
      record({ prompt: "flaky", passed: false, hops: 0 }),
      record({ prompt: "flaky", passed: true, hops: 1 }),
      record({ prompt: "steady", passed: true, hops: 1 }),
    ];
    const summary = summarizeScenarios(attempts);

    expect(summary.scenarios).toBe(2);
    expect(summary.attempts).toBe(4);
    expect(summary.accuracy).toBe(1);
    expect(summary.retriedToPass).toBe(2);
  });

  it("keeps attempts of different models apart", () => {
    // Same prompt, two models, is two observations — not a retry of one.
    const summary = summarizeScenarios([
      record({ prompt: "p", modelId: "gpt-5.1", passed: true }),
      record({ prompt: "p", modelId: "gpt-4.1", passed: false }),
    ]);
    expect(summary.scenarios).toBe(2);
    expect(summary.accuracy).toBe(0.5);
  });

  it("reports hop counts, the claim the consolidation was made on", () => {
    const summary = summarizeScenarios([
      record({ prompt: "a", hops: 3 }),
      record({ prompt: "b", hops: 1 }),
    ]);
    expect(summary.totalHops).toBe(4);
    expect(summary.meanHops).toBe(2);
  });

  it("returns zeroes rather than NaN for an empty log", () => {
    const summary = summarizeScenarios([]);
    expect(summary.accuracy).toBe(0);
    expect(summary.meanHops).toBe(0);
  });
});

describe("finalAttempts", () => {
  const rec = (prompt: string, modelId: string, hops: number): ScenarioRecord =>
    ({
      label: "l",
      serverRoot: "/x",
      prompt,
      expectedTool: "tomtom-discover-places",
      accepted: [],
      forbidden: [],
      modelId,
      toolsCalled: [],
      hops,
      passed: true,
      tokens: 0,
    }) as ScenarioRecord;

  it("keeps the last record per prompt and model, append order being chronological", () => {
    const finals = finalAttempts([rec("p", "m", 3), rec("p", "m", 1), rec("q", "m", 2)]);
    expect(finals).toHaveLength(2);
    expect(finals.find((r) => r.prompt === "p")?.hops).toBe(1);
  });
});

describe("readScenarioLog", () => {
  it("returns nothing for a log that was never written", () => {
    expect(readScenarioLog(join(tmpdir(), "no-such-eval-log.jsonl"))).toEqual([]);
  });

  it("parses one record per line", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-log-"));
    const path = join(dir, "runs.jsonl");
    try {
      writeFileSync(path, '{"prompt":"a","hops":1}\n{"prompt":"b","hops":2}\n');
      expect(readScenarioLog(path).map((r) => r.prompt)).toEqual(["a", "b"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("willRunScenarios", () => {
  it("clears the log for a full run", () => {
    expect(willRunScenarios(["run", "--config", "evals/vitest.config.ts"])).toBe(true);
  });

  it("clears the log for a scenarios run", () => {
    expect(willRunScenarios(["run", "--config", "evals/vitest.config.ts", "evals/scenarios"])).toBe(
      true
    );
  });

  it("leaves the log alone for a capability-only run", () => {
    // Recording the capability half of a comparison must not delete the
    // scenario half already recorded under the same label.
    expect(
      willRunScenarios(["run", "--config", "evals/vitest.config.ts", "evals/capability"])
    ).toBe(false);
  });
});

describe("conditionMismatches", () => {
  const report = (over: Record<string, unknown> = {}) =>
    ({ mode: "stdio", model: "gpt-5.1", summary: {}, results: [], ...over }) as never;

  it("passes two runs held to the same model and wiring", () => {
    expect(conditionMismatches(report(), report())).toEqual([]);
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
    const problems = conditionMismatches(report({ model: undefined }), report());
    expect(problems[0]).toContain("does not name the model");
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
    const baseline = [record("gpt-5.1"), record("", { unrepresentable: ["tomtom-analyse-data"] })];
    expect(scenarioModelMismatch(baseline, [record("gpt-5.1")])).toBeUndefined();
  });
});
