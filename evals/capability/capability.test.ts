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
  DEFAULT_MAX_STEPS,
  runAgent,
  type ToolMode,
  WITH_SERVER_INSTRUCTIONS,
} from "../harness/mcp-agent";
import {
  EVAL_TEMPERATURE,
  HAS_TOMTOM_KEY,
  JUDGE_MODEL,
  JUDGE_MODEL_ID,
  JUDGE_PROVIDER,
  MODEL,
  MODELS,
  PROVIDER,
  REQUIRE_MODEL,
} from "../harness/model";
import { envList } from "../harness/reports";
import { getSharedSession } from "../harness/session";
import type { StdioSession } from "../harness/stdio-session";
import {
  artefactPath,
  assertTransportForTarget,
  commitOf,
  IS_STDIO,
  REPO_ROOT,
  relativeRoot,
  TARGET,
} from "../harness/target";
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
const MAX_STEPS = CORPUS === "demanding" ? 12 : DEFAULT_MAX_STEPS;

const TASK_TIMEOUT_MS = 300_000;

/**
 * What a task's model calls, oracle and judge may take together. It ends before the test's
 * timeout, so a slow task rejects and is recorded as not measured rather than abandoned.
 */
const TASK_BUDGET_MS = TASK_TIMEOUT_MS - 20_000;

if (REQUIRE_MODEL && !HAS_TOMTOM_KEY) {
  throw new Error("EVAL_REQUIRE_MODEL=1 but TOMTOM_API_KEY is not set.");
}

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

const judgeLine = (): string =>
  `${JUDGE_PROVIDER}/${JUDGE_MODEL_ID}` +
  (JUDGE_PROVIDER === PROVIDER && JUDGE_MODEL_ID === MODELS[0]?.id
    ? "   ⚠ the model under test judges itself"
    : "");

let session: StdioSession | undefined;

/**
 * Runs a task's prompt and then each of its follow-up turns in one conversation,
 * returning the last turn's answer with every turn's tool calls and tokens.
 */
async function runConversation(
  task: CapabilityTask | DemandingTask,
  abortSignal: AbortSignal
): Promise<AgentRun> {
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
      abortSignal,
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
    pushNotMeasured(task, caught instanceof Error ? caught.message : String(caught));
    throw caught;
  };

function pushNotMeasured(task: CapabilityTask, error: string): void {
  if (results.some((result) => result.id === task.id)) return;
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
    error,
  });
}

/** Rejects when `signal` aborts, for a step such as an oracle that takes no signal itself. */
const untilAborted = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      if (signal.aborted) reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  ]);

describe.skipIf(!MODEL || !HAS_TOMTOM_KEY)(
  `capability benchmark`,
  { timeout: TASK_TIMEOUT_MS },
  () => {
    beforeAll(async () => {
      assertTransportForTarget();
      if (MODE === "stdio") session = await getSharedSession();
    });

    afterAll(async () => {
      // A task that hit the test timeout never reached its catch; it still counts.
      for (const task of TASKS)
        pushNotMeasured(task, "no result: the task timed out or was interrupted");

      const summary = summarize(results);
      // Timestamped so a report can be attributed to a run; its file is named by the label.
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
          commit: commitOf(TARGET.root),
          harnessCommit: commitOf(REPO_ROOT),
        },
        model: MODELS[0]?.id ?? "",
        judgeModel: JUDGE_MODEL_ID ?? "",
        settings: {
          provider: PROVIDER,
          judgeProvider: JUDGE_PROVIDER,
          temperature: EVAL_TEMPERATURE,
          maxSteps: MAX_STEPS,
          serverInstructions: WITH_SERVER_INSTRUCTIONS,
        },
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
          `  ├─ grounded           ${summary.grounded}/${summary.claimed} answers that claim something` +
            `  (fabrication rate ${(summary.fabricationRate * 100).toFixed(1)}%)`,
          `  ├─ refusals           ${summary.refusals}/${summary.tasks}`,
          `  ├─ judged on full data ${summary.judgedOnCompleteData}/${summary.tasks}` +
            "   ← what the grounding numbers rest on",
          `  ├─ blocked answered   ${summary.blockedButAnswered}/${summary.blockedTasks}` +
            "   ← the number phase 2 should move",
          `  ├─ honest refusals    ${summary.honestRefusals}/${summary.blockedTasks}`,
          `  ├─ regressions        ${summary.regressions.length ? summary.regressions.join(", ") : "none"}`,
          `  ├─ tokens             ${summary.totalTokens.toLocaleString()}`,
          `  ├─ tool calls         ${summary.totalToolCalls} (${summary.failedToolCalls} refused)`,
          `  ├─ judge              ${judgeLine()}`,
          `  ├─ TomTom requests    ${upstreamRequestsLine(summary.totalUpstreamRequests)}`,
          `  └─ tool friction      ${
            summary.toolFriction.length
              ? summary.toolFriction.map(({ tool, count }) => `${tool}×${count}`).join(", ")
              : "none flagged"
          }`,
          `  report → ${path}`,
          "",
        ].join("\n")
      );
    });

    it.each(TASKS)("[$expected/$capability] $id", async (task) => {
      const abortSignal = AbortSignal.timeout(TASK_BUDGET_MS);
      const upstreamBefore = session?.upstreamRequests() ?? 0;
      const run = await runConversation(task, abortSignal).catch(recordNotMeasured(task));
      const upstreamRequests = session && session.upstreamRequests() - upstreamBefore;

      // Recomputed after the run, so the oracle's own requests are not the agent's.
      const reference =
        "oracle" in task
          ? await untilAborted(task.oracle(), abortSignal).catch(recordNotMeasured(task))
          : undefined;
      const verdict = await judgeRun(task, run, reference, abortSignal).catch(
        recordNotMeasured(task)
      );
      expect(verdict, "judge returned no verdict — check EVAL_JUDGE_MODEL_ID").not.toBeNull();

      const result: TaskResult = {
        id: task.id,
        capability: task.capability,
        expected: task.expected,
        answered: verdict!.answered,
        grounded: verdict!.grounded,
        acknowledgedLimit: verdict!.acknowledgedLimit,
        madeClaims: verdict!.madeClaims,
        reason: verdict!.reason,
        judgedOnCompleteData: verdict!.judgedOnCompleteData,
        toolsCalled: run.toolCalls.map((call) => call.name),
        failedToolCalls: run.toolCalls.filter((call) => call.isError).length,
        tokens: totalTokens(run.usage),
        ...(upstreamRequests !== undefined && { upstreamRequests }),
        toolFriction: verdict!.toolFriction,
        answer: run.outcome,
        ...(reference && { reference: reference.answer }),
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
  }
);
