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

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./harness/target";
import { manifestOf, planSweep } from "./sweep";

const AZURE = { AZURE_RESOURCE_NAME: "resource", AZURE_API_KEY: "key" };

const scratch = mkdtempSync(join(tmpdir(), "eval-plan-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Another checkout: what `resolveTarget` needs to accept one. */
const checkout = (() => {
  const root = join(scratch, "baseline");
  mkdirSync(join(root, "bin"), { recursive: true });
  writeFileSync(join(root, "bin", "tomtom-mcp.js"), "");
  return root;
})();

describe("planSweep", () => {
  it("reads each target's label, root and vocabulary", () => {
    const plan = planSweep(
      [
        "--target",
        `main=${checkout}`,
        "--target",
        "pr=.:consolidated",
        "--target",
        `old=${checkout}:consolidated`,
      ],
      AZURE
    );
    expect(plan.targets).toEqual([
      { label: "main", root: checkout, surface: "legacy" },
      { label: "pr", root: REPO_ROOT, surface: "consolidated" },
      { label: "old", root: checkout, surface: "consolidated" },
    ]);
    expect(plan).toMatchObject({
      repeats: 3,
      corpus: "standard",
      suites: ["capability", "scenarios"],
    });
    expect(plan.env).toMatchObject({ EVAL_REQUIRE_MODEL: "1", EVAL_TRANSPORT: "stdio" });
  });

  it("passes the corpus, repeats, models and judge on to every run", () => {
    const plan = planSweep(
      [
        "--target",
        "pr=.",
        "--corpus",
        "demanding",
        "--repeats",
        "5",
        "--models",
        "gpt-4.1",
        "--judge",
        "azure/gpt-5.1",
        "--suites",
        "capability",
      ],
      AZURE
    );
    expect(plan).toMatchObject({ repeats: 5, corpus: "demanding", suites: ["capability"] });
    expect(plan.env).toMatchObject({
      EVAL_CORPUS: "demanding",
      EVAL_MODEL_IDS: "gpt-4.1",
      EVAL_JUDGE_PROVIDER: "azure",
      EVAL_JUDGE_MODEL_ID: "gpt-5.1",
    });
    expect(plan.warnings).toEqual([]);
  });

  it("warns, without changing the judge, when the model under test would judge itself", () => {
    const alone = planSweep(["--target", "pr=.", "--models", "gpt-4.1"], AZURE);
    expect(alone.env).not.toHaveProperty("EVAL_JUDGE_PROVIDER");
    expect(alone.warnings).toEqual([
      "gpt-4.1 would judge its own capability runs; no other provider has credentials to judge it.",
    ]);
    const withAnthropic = planSweep(["--target", "pr=.", "--models", "gpt-4.1"], {
      ...AZURE,
      ANTHROPIC_API_KEY: "key",
    });
    expect(withAnthropic.warnings[0]).toContain(
      "--judge anthropic grades them on another provider"
    );
    expect(planSweep(["--target", "pr=."], AZURE).warnings).toEqual([]);
  });

  it("refuses, before any run, what it could not run", () => {
    expect(() => planSweep(["--target", "pr"], AZURE)).toThrow(/<label>=<root>/);
    expect(() => planSweep(["--target", "a/b=."], AZURE)).toThrow(/<label>=<root>/);
    expect(() => planSweep(["--target", "a=.", "--target", "a=."], AZURE)).toThrow(/labelled "a"/);
    expect(() => planSweep(["--target", `a=${join(scratch, "nowhere")}`], AZURE)).toThrow(
      /bin\/tomtom-mcp\.js/
    );
    expect(() => planSweep(["--target", "a=.", "--repeats", "0"], AZURE)).toThrow(/--repeats/);
    expect(() => planSweep(["--target", "a=.", "--corpus", "hard"], AZURE)).toThrow(/--corpus/);
    expect(() => planSweep(["--target", "a=.", "--suites", "capability,ui"], AZURE)).toThrow(
      /--suites/
    );
    expect(() => planSweep(["--phases", "phase9"], AZURE)).toThrow(/phase9/);
    expect(() => planSweep(["--phases", "all", "--target", "a=."], AZURE)).toThrow(/not both/);
    expect(() => planSweep(["--target", "a=.", "--judge", "anthropic"], AZURE)).toThrow(
      /ANTHROPIC_API_KEY/
    );
  });

  it("reuses a target's runs from an earlier sweep only when that sweep has them", () => {
    const earlier = join(scratch, "earlier");
    mkdirSync(earlier, { recursive: true });
    writeFileSync(join(earlier, "report.main.1.json"), "{}");
    const plan = planSweep(
      ["--target", `main=${checkout}`, "--target", "pr=.", "--reuse", `main=${earlier}`],
      AZURE
    );
    expect(plan.targets[0].reusedFrom).toBe(earlier);
    expect(() =>
      planSweep(
        ["--target", `main=${checkout}`, "--target", "pr=.", "--reuse", `pr=${earlier}`],
        AZURE
      )
    ).toThrow(/holds no report\.pr/);
    expect(() => planSweep(["--target", "pr=.", "--reuse", `main=${earlier}`], AZURE)).toThrow(
      /among the targets/
    );
  });
});

describe("manifestOf", () => {
  it("names each target's checkout relative to this one, with the task filter and budget", () => {
    const plan = planSweep(["--target", "pr=."], AZURE);
    const manifest = manifestOf(plan, new Date("2026-11-04T10:00:00Z"), {
      EVAL_TASK_IDS: "lookup-geocode, derive-*",
      EVAL_MAX_TOKENS: "2000000",
    });
    expect(manifest).toMatchObject({
      startedAt: "2026-11-04T10:00:00.000Z",
      targets: [{ label: "pr", root: ".", surface: "consolidated" }],
      taskFilter: ["lookup-geocode", "derive-*"],
      maxTokens: 2_000_000,
    });
  });
});
