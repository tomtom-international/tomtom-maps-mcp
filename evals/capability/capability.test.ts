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
 * The capability benchmark. Runs the corpus against LIVE tools, judges each
 * answer, writes a report, and asserts the two things that must hold:
 *
 *   1. no task fabricates;
 *   2. no `expected: "pass"` task regresses.
 *
 * Blocked tasks are recorded, not asserted — `report.json` is the artefact to
 * diff across phases.
 */

import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  artefactPath,
  assertTransportForTarget,
  getSharedSession,
  HAS_TOMTOM_KEY,
  MODEL,
  MODELS,
  runAgent,
  type StdioSession,
  TARGET,
  type ToolMode,
} from "../harness";
import { totalTokens } from "../vendor/types";
import { judgeRun, summarize, type TaskResult } from "./judge";
import { CAPABILITY_TASKS } from "./tasks";

/**
 * Run a SUBSET of the corpus: `EVAL_TASK_IDS=lookup-ev-availability,...`.
 *
 * For checking one fix without paying for the whole corpus. The chosen ids are
 * stamped into the report, because a 4-task report is not a 14-task report and
 * nothing else in the file would say so — the same failure the `notMeasured`
 * field exists to prevent, arrived at deliberately instead of by accident.
 */
const TASK_FILTER = (process.env.EVAL_TASK_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const TASKS = TASK_FILTER.length
  ? CAPABILITY_TASKS.filter((task) => TASK_FILTER.includes(task.id))
  : CAPABILITY_TASKS;

if (TASK_FILTER.length && TASKS.length !== TASK_FILTER.length) {
  const missing = TASK_FILTER.filter((id) => !CAPABILITY_TASKS.some((t) => t.id === id));
  throw new Error(`EVAL_TASK_IDS names tasks that do not exist: ${missing.join(", ")}`);
}

// Live tools mean real API quota, so the benchmark runs against ONE model (the
// first configured) rather than the whole list. Selection scenarios are the
// multi-model guard; this suite measures capability, and capability is a property
// of the tool surface, not of the model picking from it.
const model = MODELS[0]?.model;

/**
 * `EVAL_TRANSPORT=stdio` runs every task against a real `bin/tomtom-mcp.js`
 * subprocess over the MCP transport instead of in-process tools — the same tool
 * surface a real client sees, including JSON-Schema conversion and the
 * text-envelope round-trip. Off by default because it needs a fresh `pnpm build`.
 *
 * The scores should MATCH the in-process run. A divergence is itself the finding:
 * it means something about the MCP boundary changes what reaches the model.
 */
const MODE: ToolMode = process.env.EVAL_TRANSPORT === "stdio" ? "stdio" : "live";

/**
 * A baseline run scores ANOTHER checkout's server (`EVAL_SERVER_ROOT`) through
 * this same corpus and judge — that is how the before/after gets made. Its
 * results are recorded, never asserted: the old surface fails the blocked tasks
 * by construction, and a red run would say nothing about this working tree. The
 * artefact is the point.
 */
const RECORD_ONLY = TARGET.isBaseline;

let session: StdioSession | undefined;

const results: TaskResult[] = [];
describe.skipIf(!MODEL || !HAS_TOMTOM_KEY)(`capability benchmark`, { timeout: 300_000 }, () => {
  beforeAll(async () => {
    assertTransportForTarget(process.env.EVAL_TRANSPORT);
    if (MODE === "stdio") session = await getSharedSession();
  });

  afterAll(async () => {
    if (!results.length) return;

    const summary = summarize(results);
    // Timestamped so a report can be attributed to a run, but the FILE name is
    // stable so `git diff` across phases shows what moved.
    const report = {
      generatedAt: new Date().toISOString(),
      // Which wiring produced these numbers — an in-process report and a
      // transport report are not interchangeable, so the file says which.
      mode: MODE,
      // And which SERVER produced them. A report that does not name its
      // checkout cannot be used as a baseline: two files of numbers with no
      // provenance are not a comparison.
      target: { label: TARGET.label || "current", root: TARGET.root, baseline: TARGET.isBaseline },
      model: MODELS[0]?.id ?? "",
      // Present only on a filtered run, so a subset report is self-identifying.
      ...(TASK_FILTER.length && { taskFilter: TASK_FILTER }),
      summary,
      results,
    };
    const path = artefactPath(import.meta.dirname, "report");
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);

    console.log(
      [
        "",
        `  capability benchmark (${MODE}${TARGET.label ? `, ${TARGET.label}` : ""})` +
          (RECORD_ONLY ? "  — RECORDING ONLY, assertions off" : ""),
        `  ├─ tasks              ${summary.tasks}`,
        `  ├─ answered           ${summary.answered}/${summary.tasks}`,
        `  ├─ grounded           ${summary.grounded}/${summary.tasks}` +
          `  (fabrication rate ${(summary.fabricationRate * 100).toFixed(1)}%)`,
        `  ├─ judged on full data ${summary.judgedOnCompleteData}/${summary.tasks}` +
          "   ← what the grounding numbers rest on",
        `  ├─ blocked answered   ${summary.blockedButAnswered}/${summary.blockedTasks}` +
          "   ← the number phase 2 should move",
        `  ├─ honest refusals    ${summary.honestRefusals}/${summary.blockedTasks}`,
        `  ├─ regressions        ${summary.regressions.length ? summary.regressions.join(", ") : "none"}`,
        `  ├─ tokens             ${summary.totalTokens.toLocaleString()}`,
        `  └─ tool friction      ${
          summary.toolFriction.length
            ? summary.toolFriction.map((f) => `${f.tool}×${f.count}`).join(", ")
            : "none flagged"
        }`,
        `  report → ${path}`,
        "",
      ].join("\n")
    );
  });

  it.each(TASKS)("[$expected/$capability] $id", async (task) => {
    // A task that throws — a model endpoint timing out, the server dying — used
    // to leave `results` untouched, so it disappeared from the report and every
    // denominator in the summary shrank by one without saying so. Record the
    // gap, then rethrow so the run is still visibly red.
    const run = await runAgent({
      model: model!,
      mode: MODE,
      session,
      messages: [{ role: "user", content: task.prompt }],
    }).catch((caught: unknown) => {
      results.push({
        id: task.id,
        capability: task.capability,
        expected: task.expected,
        answered: false,
        grounded: false,
        acknowledgedLimit: false,
        reason: "not measured",
        judgedOnCompleteData: false,
        toolsCalled: [],
        tokens: 0,
        toolFriction: [],
        error: caught instanceof Error ? caught.message : String(caught),
      });
      throw caught;
    });

    const verdict = await judgeRun(task, run);
    expect(verdict, "judge returned no verdict — check EVAL_JUDGE_MODEL_ID").not.toBeNull();

    const result: TaskResult = {
      id: task.id,
      capability: task.capability,
      expected: task.expected,
      answered: verdict!.answered,
      grounded: verdict!.grounded,
      acknowledgedLimit: verdict!.acknowledgedLimit,
      reason: verdict!.reason,
      judgedOnCompleteData: verdict!.judgedOnCompleteData,
      toolsCalled: run.toolCalls.map((call) => call.name),
      tokens: totalTokens(run.usage),
      toolFriction: verdict!.toolFriction,
    };
    results.push(result);

    const diagnostic =
      `\n  task:     ${task.id} (${task.capability}, expected ${task.expected})` +
      `\n  mode:     ${MODE}` +
      `\n  tools:    [${result.toolsCalled.join(", ") || "none"}]` +
      `\n  verdict:  answered=${result.answered} grounded=${result.grounded} ` +
      `acknowledgedLimit=${result.acknowledgedLimit} ` +
      `judgedOnCompleteData=${result.judgedOnCompleteData}` +
      `\n  judge:    ${result.reason}` +
      `\n  answer:   "${run.outcome.trim().slice(0, 400)}"\n`;

    // A baseline is a measurement of a surface we already know fails these
    // tasks; asserting against it would report the old server's known gaps as
    // failures of this branch. The numbers still land in the report, which is
    // the only thing a baseline run is for.
    if (RECORD_ONLY) {
      if (!result.grounded) console.warn(`  ⚠ [${TARGET.label}] FABRICATED${diagnostic}`);
      return;
    }

    // (1) Fabrication is never acceptable — on a blocked task the correct
    // behaviour is to say what could not be determined, not to guess from a
    // truncated list. This assertion is what keeps `blockedButAnswered` an
    // honest score rather than a number gamed by confident guessing.
    expect(result.grounded, `FABRICATED${diagnostic}`).toBe(true);

    // (2) Tasks answerable today must stay answerable. Blocked tasks are
    // recorded only — asserting them would just make the suite permanently red
    // until phase 2 lands.
    if (task.expected === "pass") {
      expect(result.answered, `REGRESSION${diagnostic}`).toBe(true);
    }
  });
});
