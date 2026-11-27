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
import { afterAll, beforeAll, describe, expect, it, type TestContext } from "vitest";
import {
  type AgentRun,
  agentSetup,
  DEFAULT_MAX_STEPS,
  describeTools,
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
import { type FormVerdict, judgeForm, verdictOf } from "../review/form-judge";
import { questionsAnswered } from "../review/reviews";
import { type Metrics, metricsOfResults } from "../review/metrics";
import { metricsTable } from "../review/metrics-format";
import { type RunContext, type Transcript, writeRun } from "../review/runs";
import { totalTokens } from "../vendor/types";
import {
  type CapabilityReport,
  type JudgeToolView,
  judgeView,
  summarize,
  type TaskResult,
} from "./judge";
import type { Reference } from "./oracles";
import { CAPABILITY_TASKS, type CapabilityTask, CORPORA, type Corpus, isCorpus } from "./tasks";
import { DEMANDING_TASKS, type DemandingTask } from "./tasks-demanding";
import { GOLDEN_TASKS } from "./tasks-golden";

/**
 * Which corpus to run, by `EVAL_CORPUS`: the 33-task `standard` one (the default), `demanding`
 * (`tasks-demanding.ts`), whose tasks are judged against a live oracle and may span several
 * turns, or `golden` (`tasks-golden.ts`). Stamped into the report, as they are not comparable.
 */
const REQUESTED_CORPUS = process.env.EVAL_CORPUS || "standard";
if (!isCorpus(REQUESTED_CORPUS)) {
  throw new Error(`EVAL_CORPUS "${REQUESTED_CORPUS}" is not one of ${CORPORA.join(", ")}.`);
}
const CORPUS: Corpus = REQUESTED_CORPUS;
const TASKS_BY_CORPUS: Record<Corpus, readonly (CapabilityTask | DemandingTask)[]> = {
  standard: CAPABILITY_TASKS,
  demanding: DEMANDING_TASKS,
  golden: GOLDEN_TASKS,
};
const CORPUS_TASKS = TASKS_BY_CORPUS[CORPUS];

/**
 * `EVAL_COLLECT_ONLY=1` gathers answers for people to label: every task is run, judged and saved
 * for review, and none is asserted, so a made-up answer is recorded, not a failure.
 */
const COLLECT_ONLY = process.env.EVAL_COLLECT_ONLY === "1";

/** `EVAL_RECORD_RUN=1` also saves every transcript to `evals/golden/runs/`, for review. */
const RECORD_RUN = process.env.EVAL_RECORD_RUN === "1" || COLLECT_ONLY;

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

// Without a judge every task would pay for its agent run and then fail unscored.
if (MODEL && HAS_TOMTOM_KEY && !JUDGE_MODEL) {
  throw new Error(
    `No judge model for provider "${JUDGE_PROVIDER}". Set EVAL_JUDGE_MODEL_ID, or ` +
      "EVAL_JUDGE_PROVIDER to a provider with a default judge (azure, anthropic)."
  );
}

/**
 * Run a SUBSET of the corpus: `EVAL_TASK_IDS=lookup-ev-availability,derive-*,...`, where a
 * trailing `*` matches an id prefix.
 *
 * For checking one fix without paying for the whole corpus. The chosen ids are
 * stamped into the report, because a subset's report is not the corpus's and
 * nothing else in the file would say so.
 */
const TASK_PATTERNS = envList("EVAL_TASK_IDS");

const matchesTask = (pattern: string, id: string): boolean =>
  pattern.endsWith("*") ? id.startsWith(pattern.slice(0, -1)) : id === pattern;

const TASKS = TASK_PATTERNS.length
  ? CORPUS_TASKS.filter((task) => TASK_PATTERNS.some((pattern) => matchesTask(pattern, task.id)))
  : CORPUS_TASKS;

const unmatched = TASK_PATTERNS.filter(
  (pattern) => !CORPUS_TASKS.some((task) => matchesTask(pattern, task.id))
);
if (unmatched.length) {
  throw new Error(`EVAL_TASK_IDS matches no ${CORPUS} task: ${unmatched.join(", ")}`);
}

const IS_SUBSET = TASKS.length < CORPUS_TASKS.length;

/**
 * `EVAL_MAX_TOKENS`: what one run may spend, the agent's tokens and the judge's together.
 * Checked before each task, so the task that crosses it still finishes and the rest are
 * recorded as not measured.
 */
const MAX_TOKENS = process.env.EVAL_MAX_TOKENS ? Number(process.env.EVAL_MAX_TOKENS) : undefined;

if (MAX_TOKENS !== undefined && !(Number.isInteger(MAX_TOKENS) && MAX_TOKENS > 0)) {
  throw new Error(
    `EVAL_MAX_TOKENS="${process.env.EVAL_MAX_TOKENS}" is not a positive whole number of tokens.`
  );
}

let spentTokens = 0;
const unrunByBudget: string[] = [];

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
 * artefact is the point. A collect-only run is recorded the same way.
 */
const RECORD_ONLY = TARGET.isBaseline || COLLECT_ONLY;

const upstreamRequestsLine = (count: number): string =>
  MODE === "stdio" ? String(count) : "not counted in-process";

const judgeLine = (): string =>
  `${JUDGE_PROVIDER}/${JUDGE_MODEL_ID}` +
  (JUDGE_PROVIDER === PROVIDER && JUDGE_MODEL_ID === MODELS[0]?.id
    ? "   ⚠ the model under test judges itself"
    : "");

const tasksLine = (measured: number): string =>
  IS_SUBSET
    ? `${measured} of the ${CORPUS_TASKS.length} in the corpus, by EVAL_TASK_IDS`
    : String(measured);

const budgetLines = (): string[] =>
  MAX_TOKENS
    ? [
        `  ├─ budget             ${spentTokens.toLocaleString()} of ` +
          `${MAX_TOKENS.toLocaleString()} spent` +
          (unrunByBudget.length ? `, ${unrunByBudget.length} task(s) not run` : ""),
      ]
    : [];

let session: StdioSession | undefined;

/** The user's turns in order: the prompt, then any follow-ups. */
const turnsOf = (task: CapabilityTask | DemandingTask): string[] => [
  task.prompt,
  ...("turns" in task ? (task.turns ?? []) : []),
];

/**
 * Runs a task's prompt and then each of its follow-up turns in one conversation,
 * returning the last turn's answer with every turn's tool calls and tokens. Each turn's
 * tokens count towards `EVAL_MAX_TOKENS` as it returns, so a turn that times out later
 * leaves the finished ones counted.
 */
async function runConversation(
  task: CapabilityTask | DemandingTask,
  abortSignal: AbortSignal
): Promise<AgentRun> {
  const turns = turnsOf(task);
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
    spentTokens += totalTokens(last.usage);
  }
  return { outcome, toolCalls, usage, messages: history };
}

const results: TaskResult[] = [];
/** Filled only under `EVAL_RECORD_RUN=1`; a task that threw has no transcript. */
const transcripts: Transcript[] = [];

/** Keeps a judged task as the review page shows it, with each tool call in the judge's view. */
function recordTranscript(
  task: CapabilityTask | DemandingTask,
  run: AgentRun,
  reference: Reference | undefined,
  { toolViews, verdict }: { toolViews: JudgeToolView[]; verdict: FormVerdict }
): void {
  if (!RECORD_RUN) return;
  transcripts.push({
    taskId: task.id,
    capability: task.capability,
    expected: task.expected,
    turns: turnsOf(task),
    rubric: task.rubric,
    ...(reference && { reference: reference.answer }),
    answer: run.outcome,
    toolCalls: toolViews,
    judge: {
      ...verdictOf(verdict.labels),
      reason: verdict.reason,
      judgedOnCompleteData: onCompleteData(toolViews),
    },
  });
}

/** Whether the judge saw every tool call whole, so a fabrication rate can say what it rests on. */
const onCompleteData = (toolViews: readonly JudgeToolView[]): boolean =>
  toolViews.every((view) => view.abridged === null);

/** The tools and instructions the model gets, as a recorded run and the form judge show them. */
function runContext(): RunContext {
  const { tools, system } = agentSetup(MODE, session, []);
  return { system, tools: describeTools(tools), filledInLater: false };
}

/** The judge fills in the review form about a run. Throws without a judge model. */
async function judgeTask(
  task: CapabilityTask | DemandingTask,
  run: AgentRun,
  reference: Reference | undefined,
  abortSignal: AbortSignal
): Promise<{ toolViews: JudgeToolView[]; verdict: FormVerdict }> {
  if (!JUDGE_MODEL) throw new Error("No judge model: set EVAL_JUDGE_MODEL_ID.");
  const toolViews = judgeView(run.toolCalls);
  const verdict = await judgeForm(
    JUDGE_MODEL,
    {
      task: { id: task.id, capability: task.capability, expected: task.expected },
      turns: turnsOf(task),
      rubric: task.rubric,
      reference: reference?.answer,
      toolViews,
      answer: run.outcome,
      context: runContext(),
    },
    abortSignal
  );
  return { toolViews, verdict };
}

/** The summary's metrics table; absent when no task was judged. */
const metricsLines = (metrics: Metrics | undefined): string[] =>
  metrics
    ? [
        "  metrics, from the judge's answers to the review form:",
        "",
        metricsTable([
          {
            name: TARGET.label || "current",
            metrics,
            asked: questionsAnswered(results.flatMap(({ labels }) => (labels ? [labels] : []))),
          },
        ]),
        "",
      ]
    : [];

/** Saves the recorded transcripts for review; returns the summary line naming the file, if any. */
function saveRecordedRun(report: CapabilityReport): string[] {
  if (!transcripts.length) return [];
  const file = writeRun({
    model: report.model,
    provider: PROVIDER ?? "",
    judgeModel: report.judgeModel,
    temperature: EVAL_TEMPERATURE,
    maxSteps: MAX_STEPS,
    corpus: CORPUS,
    commit: report.target.commit ?? "",
    generatedAt: report.generatedAt,
    context: runContext(),
    transcripts,
  });
  return [`  run for review → ${file}`];
}

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

/** Records `task` as not measured, and skips it, once `EVAL_MAX_TOKENS` is spent. */
function skipOnceBudgetSpent(task: CapabilityTask, context: TestContext): void {
  if (!MAX_TOKENS || spentTokens < MAX_TOKENS) return;
  const reason = `not run: the EVAL_MAX_TOKENS budget of ${MAX_TOKENS} tokens was spent`;
  pushNotMeasured(task, reason);
  unrunByBudget.push(task.id);
  context.skip(reason);
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
      const metrics = metricsOfResults(results);
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
        ...(IS_SUBSET && { taskFilter: TASKS.map((task) => task.id) }),
        ...(MAX_TOKENS && {
          budget: { maxTokens: MAX_TOKENS, spentTokens, unrun: unrunByBudget },
        }),
        summary,
        metrics,
        results,
      };
      const path = artefactPath(import.meta.dirname, "report");
      writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
      const recordedRunLines = saveRecordedRun(report);

      console.log(
        [
          "",
          `  capability benchmark (${MODE}${TARGET.label ? `, ${TARGET.label}` : ""})` +
            (RECORD_ONLY ? "  — RECORDING ONLY, assertions off" : ""),
          `  ├─ tasks              ${tasksLine(summary.tasks)}`,
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
          `  ├─ tokens             ${summary.totalTokens.toLocaleString()} agent, ` +
            `${summary.totalJudgeTokens.toLocaleString()} judge`,
          ...budgetLines(),
          `  ├─ tool calls         ${summary.totalToolCalls} (${summary.failedToolCalls} refused)`,
          `  ├─ judge              ${judgeLine()}`,
          `  ├─ TomTom requests    ${upstreamRequestsLine(summary.totalUpstreamRequests)}`,
          `  └─ tool friction      ${
            summary.toolFriction.length
              ? summary.toolFriction.map(({ tool, count }) => `${tool}×${count}`).join(", ")
              : "none flagged"
          }`,
          `  report → ${path}`,
          ...recordedRunLines,
          "",
          ...metricsLines(metrics),
        ].join("\n")
      );
    });

    it.for(TASKS)("[$expected/$capability] $id", async (task, context) => {
      skipOnceBudgetSpent(task, context);
      const abortSignal = AbortSignal.timeout(TASK_BUDGET_MS);
      const upstreamBefore = session?.upstreamRequests() ?? 0;
      const run = await runConversation(task, abortSignal).catch(recordNotMeasured(task));
      const upstreamRequests = session && session.upstreamRequests() - upstreamBefore;

      // Recomputed after the run, so the oracle's own requests are not the agent's.
      const reference =
        "oracle" in task
          ? await untilAborted(task.oracle(), abortSignal).catch(recordNotMeasured(task))
          : undefined;
      const judged = await judgeTask(task, run, reference, abortSignal).catch(
        recordNotMeasured(task)
      );
      const { labels, reason, toolFriction, judgeTokens } = judged.verdict;
      spentTokens += judgeTokens;

      const result: TaskResult = {
        id: task.id,
        capability: task.capability,
        expected: task.expected,
        ...verdictOf(labels),
        reason,
        judgedOnCompleteData: onCompleteData(judged.toolViews),
        toolsCalled: run.toolCalls.map((call) => call.name),
        failedToolCalls: run.toolCalls.filter((call) => call.isError).length,
        tokens: totalTokens(run.usage),
        judgeTokens,
        ...(upstreamRequests !== undefined && { upstreamRequests }),
        toolFriction,
        answer: run.outcome,
        ...(reference && { reference: reference.answer }),
        // `EVAL_TRACE=1` keeps each call's input, to read what the model asked for.
        ...(process.env.EVAL_TRACE === "1" && {
          trace: run.toolCalls.map(({ name, input }) => ({ name, input })),
        }),
        labels,
      };
      results.push(result);
      recordTranscript(task, run, reference, judged);

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

      // (1) Fabrication is never acceptable: a figure or name no tool returned fails here.
      // A capped count passed off as the whole is taken from the tools, so the form counts
      // it as grounded (labeling-decisions.md, D5); the rubric fails it, which keeps it out
      // of `blockedButAnswered`.
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
