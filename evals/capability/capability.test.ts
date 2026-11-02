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
 * Blocked tasks are recorded, not asserted — the report is what a comparison reads.
 */

import { writeFileSync } from "node:fs";
import type { ModelMessage } from "ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AgentRun,
  artefactPath,
  assertTransportForTarget,
  envList,
  getSharedSession,
  HAS_TOMTOM_KEY,
  IS_STDIO,
  JUDGE_MODEL_ID,
  MODEL,
  MODELS,
  relativeRoot,
  runAgent,
  type StdioSession,
  TARGET,
  type ToolMode,
} from "../harness";
import { totalTokens } from "../vendor/types";
import { type CapabilityReport, judgeRun, summarize, type TaskResult } from "./judge";
import { CAPABILITY_TASKS, type CapabilityTask } from "./tasks";
import { DEMANDING_TASKS, type DemandingTask } from "./tasks-demanding";

/**
 * Which corpus to run: the 29-task `standard` one, or `demanding`
 * (`tasks-demanding.ts`), whose tasks are judged against a live oracle and may
 * span several turns. Stamped into the report, as the two are not comparable.
 */
const CORPUS = process.env.EVAL_CORPUS === "demanding" ? "demanding" : "standard";
const CORPUS_TASKS: readonly (CapabilityTask | DemandingTask)[] =
  CORPUS === "demanding" ? DEMANDING_TASKS : CAPABILITY_TASKS;

/** Steps per turn: a demanding task may fetch several results and compute over them. */
const MAX_STEPS = CORPUS === "demanding" ? 12 : undefined;

/**
 * Run a SUBSET of the corpus: `EVAL_TASK_IDS=lookup-ev-availability,...`.
 *
 * For checking one fix without paying for the whole corpus. The chosen ids are
 * stamped into the report, because a 4-task report is not an 18-task report and
 * nothing else in the file would say so — the same failure the `notMeasured`
 * field exists to prevent, arrived at deliberately instead of by accident.
 */
const TASK_FILTER = envList("EVAL_TASK_IDS");

const TASKS = TASK_FILTER.length
  ? CORPUS_TASKS.filter((task) => TASK_FILTER.includes(task.id))
  : CORPUS_TASKS;

if (TASK_FILTER.length && TASKS.length !== TASK_FILTER.length) {
  const missing = TASK_FILTER.filter((id) => !CORPUS_TASKS.some((t) => t.id === id));
  throw new Error(`EVAL_TASK_IDS names tasks that do not exist: ${missing.join(", ")}`);
}

/**
 * `EVAL_TRANSPORT=stdio` runs every task against a real `bin/tomtom-mcp.js`
 * subprocess over the MCP transport instead of in-process tools — the same tool
 * surface a real client sees, including JSON-Schema conversion and the
 * text-envelope round-trip. Off by default because it needs a fresh `pnpm build`.
 *
 * The scores should MATCH the in-process run. A divergence is itself the finding:
 * it means something about the MCP boundary changes what reaches the model.
 */
const MODE: ToolMode = IS_STDIO ? "stdio" : "live";

/**
 * A baseline run scores ANOTHER checkout's server (`EVAL_SERVER_ROOT`) through
 * this same corpus and judge — that is how the before/after gets made. Its
 * results are recorded, never asserted: the old surface fails the blocked tasks
 * by construction, and a red run would say nothing about this working tree. The
 * artefact is the point.
 */
const RECORD_ONLY = TARGET.isBaseline;

const upstreamRequestsLine = (count: number): string =>
  MODE === "stdio" ? String(count) : "not counted in-process";

let session: StdioSession | undefined;

/**
 * Runs a task's prompt and then each of its follow-up turns in one conversation,
 * returning the last turn's answer with every turn's tool calls and tokens.
 */
async function runConversation(task: CapabilityTask | DemandingTask): Promise<AgentRun> {
  const turns = [task.prompt, ...("turns" in task ? (task.turns ?? []) : [])];
  let history: ModelMessage[] = [];
  let outcome = "";
  const toolCalls: AgentRun["toolCalls"] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  for (const content of turns) {
    history = [...history, { role: "user", content }];
    const last = await runAgent({
      // Live tools mean real API quota, so the benchmark runs against ONE model
      // (`MODEL`, the first configured) rather than the whole list. Selection
      // scenarios are the multi-model guard; this suite measures capability, and
      // capability is a property of the tool surface, not of the model picking from it.
      model: MODEL!,
      mode: MODE,
      session,
      messages: history,
      maxSteps: MAX_STEPS,
    });
    history = [...history, ...last.messages];
    outcome = last.outcome;
    toolCalls.push(...last.toolCalls);
    usage.inputTokens += last.usage.inputTokens;
    usage.outputTokens += last.usage.outputTokens;
  }
  return { outcome, toolCalls, usage, messages: history };
}

const results: TaskResult[] = [];

/**
 * Records a task that threw — the model endpoint or the judge timing out, the
 * server dying — then rethrows so the run is still visibly red. Without the
 * record the task vanishes from `results` and every denominator in the summary
 * shrinks by one without saying so.
 */
const recordNotMeasured =
  (task: CapabilityTask) =>
  (caught: unknown): never => {
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
  };

describe.skipIf(!MODEL || !HAS_TOMTOM_KEY)(`capability benchmark`, { timeout: 300_000 }, () => {
  beforeAll(async () => {
    assertTransportForTarget();
    if (MODE === "stdio") session = await getSharedSession();
  });

  afterAll(async () => {
    if (!results.length) return;

    const summary = summarize(results);
    // Timestamped so a report can be attributed to a run, but the FILE name is
    // stable so `git diff` across phases shows what moved.
    const report: CapabilityReport = {
      generatedAt: new Date().toISOString(),
      // Which wiring produced these numbers — an in-process report and a
      // transport report are not interchangeable, so the file says which.
      mode: MODE,
      // And which SERVER produced them. A report that does not name its
      // checkout cannot be used as a baseline: two files of numbers with no
      // provenance are not a comparison.
      target: {
        label: TARGET.label || "current",
        root: relativeRoot(),
        baseline: TARGET.isBaseline,
      },
      model: MODELS[0]?.id ?? "",
      judgeModel: JUDGE_MODEL_ID ?? "",
      corpus: CORPUS,
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
        `  ├─ tool calls         ${summary.totalToolCalls}`,
        `  ├─ TomTom requests    ${upstreamRequestsLine(summary.totalUpstreamRequests)}`,
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
    const upstreamBefore = session?.upstreamRequests() ?? 0;
    const run = await runConversation(task).catch(recordNotMeasured(task));
    const upstreamRequests = session && session.upstreamRequests() - upstreamBefore;

    // Recomputed after the run, so the oracle's own requests are not the agent's.
    const reference =
      "oracle" in task ? await task.oracle().catch(recordNotMeasured(task)) : undefined;
    const verdict = await judgeRun(task, run, reference).catch(recordNotMeasured(task));
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
      ...(upstreamRequests !== undefined && { upstreamRequests }),
      toolFriction: verdict!.toolFriction,
      ...(reference && { reference: reference.answer, answer: run.outcome }),
      // `EVAL_TRACE=1` keeps each call's input, to read what the model asked for.
      ...(process.env.EVAL_TRACE === "1" && {
        trace: run.toolCalls.map(({ name, input }) => ({ name, input })),
      }),
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
