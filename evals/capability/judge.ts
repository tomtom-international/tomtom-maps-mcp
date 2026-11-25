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
 * What a capability run keeps of each task, and the numbers rolled up from it. The judge is
 * `review/form-judge.ts`: it answers the review form's scored questions, and the verdicts here are
 * worked out from them, so two of them stay apart.
 *
 * The split matters. A single "was this a good answer?" score conflates two very
 * different failures, and for this benchmark they point in opposite directions:
 *
 *   • "I can't compute that — the response was capped at 100 of 3,412 incidents"
 *     scores `answered: false, grounded: true`. That is the CORRECT behaviour for
 *     a blocked task. It is honest.
 *   • "The A10 has the most incidents, 14 of them", with a figure no tool returned,
 *     scores `answered: true, grounded: false`. That is the dangerous failure, and
 *     without the split it would look like a win.
 *
 * So `grounded` is asserted for every task and `answered` only for the ones
 * expected to pass today.
 */

import type { AgentRun, ToolMode } from "../harness/mcp-agent";
import type { ProviderId } from "../harness/model";
import type { ToolFriction } from "../review/form-judge";
import type { Metrics } from "../review/metrics";
import type { FormAnswers } from "../review/reviews";
import {
  type CompactionOptions,
  type CompactionStats,
  classifyToolCall,
  convertToEvidence,
  type ToolStatus,
} from "../vendor/tool-evidence";
import type { Capability, CapabilityTask, Corpus } from "./tasks";

/**
 * How the judge's view of each tool call is abridged. Structurally, never by
 * character count, so what it reads is always valid JSON that marks its cuts
 * (see the header of `vendor/tool-evidence.ts`).
 *
 * - `smallArrayMax` 300, against the toolkit's 8: several tasks ask for one entity
 *   out of a large list, and a judge shown `{count: 226, sample: [2]}` rules a
 *   correctly quoted incident invented. A dense traffic response is about 19k
 *   characters whole, which is affordable.
 * - `maxDepth` 12, against the port's 6: an EV result carries its live
 *   availability at `properties.chargingPark.availability.
 *   chargingPointAvailability.statusCounts.Available`, depth 8 from the response
 *   root, and the per-connector detail at 12.
 */
const EVIDENCE_OPTIONS: CompactionOptions = { smallArrayMax: 300, maxDepth: 12 };

/** The cuts one view holds, in the words the judge prompt uses for them. */
const cutsIn = (stats: CompactionStats): string[] =>
  [
    stats.collapsedArrays && `${stats.collapsedArrays} array(s) shown as {count, sample}`,
    stats.truncatedStrings && `${stats.truncatedStrings} string(s) shortened`,
    stats.nestedCuts && `${stats.nestedCuts} value(s) cut as [nested]`,
  ].filter((cut): cut is string => typeof cut === "string");

/** One tool call as the judge reads it. `abridged` names the cuts, or is null when shown whole. */
export interface JudgeToolView {
  name: string;
  status: ToolStatus;
  abridged: string | null;
  input: string;
  output: string;
}

/** Each tool call as the judge sees it; saved runs keep this view, so reviewers read the same. */
export function judgeView(toolCalls: AgentRun["toolCalls"]): JudgeToolView[] {
  return toolCalls.map((call) => {
    const input = convertToEvidence(call.input, EVIDENCE_OPTIONS);
    const output = convertToEvidence(call.output, EVIDENCE_OPTIONS);
    const cuts = [
      ...cutsIn(input.stats).map((cut) => `input: ${cut}`),
      ...cutsIn(output.stats).map((cut) => `output: ${cut}`),
    ];
    return {
      name: call.name,
      status: classifyToolCall(call),
      abridged: cuts.length ? cuts.join("; ") : null,
      input: input.text,
      output: output.text,
    };
  });
}

/** One row of the capability report. */
export interface TaskResult {
  id: string;
  capability: Capability;
  expected: CapabilityTask["expected"];
  answered: boolean;
  grounded: boolean;
  acknowledgedLimit: boolean;
  /** False for a refusal; absent on reports from before the judge was asked. */
  madeClaims?: boolean;
  reason: string;
  /** False when the judge saw an abridged view of at least one tool call. */
  judgedOnCompleteData: boolean;
  toolsCalled: string[];
  /** Calls the server answered with `isError`, counted in `toolsCalled` too. */
  failedToolCalls?: number;
  tokens: number;
  /** The judge's tokens for this task, not counted in `tokens`; absent on older reports. */
  judgeTokens?: number;
  /** Requests the server sent to TomTom for this task; absent in-process, where no server runs. */
  upstreamRequests?: number;
  toolFriction: ToolFriction;
  /** The agent's final answer, for reading a verdict back. */
  answer?: string;
  /** The oracle's answer, on a demanding task. */
  reference?: string;
  /** Each tool call's name and input, on a run with `EVAL_TRACE=1`. */
  trace?: { name: string; input: unknown }[];
  /** The judge's answers to the review form; absent on older reports. */
  labels?: FormAnswers;
  /**
   * Set when the task never produced a verdict — the model endpoint timed out,
   * the server died, the judge threw. Recorded rather than dropped: a task that
   * vanishes from `results` silently shrinks every denominator in the summary,
   * and `answered 8/12` then gets compared against `answered 9/13` with nothing
   * saying the two were scored over different corpora.
   */
  error?: string;
}

/**
 * Groups the judge's tool critiques by tool, most-flagged first.
 *
 * One task complaining about `tomtom-discover-places` is noise; the same complaint on
 * four tasks is a description that needs rewriting. Rolling it up is what turns
 * scattered remarks into a work list.
 */
function rollUpToolFriction(results: readonly TaskResult[]) {
  const byTool = new Map<string, { tool: string; count: number; notes: string[] }>();
  for (const result of results) {
    for (const friction of result.toolFriction) {
      const entry = byTool.get(friction.tool) ?? { tool: friction.tool, count: 0, notes: [] };
      entry.count += 1;
      entry.notes.push(`${friction.problem} → ${friction.suggestion}`);
      byTool.set(friction.tool, entry);
    }
  }
  return [...byTool.values()].sort((a, b) => b.count - a.count);
}

/**
 * Rolls task results into the numbers worth tracking across phases.
 *
 * `fabricationRate` is the one that must stay at zero. `blockedButAnswered` is
 * the headline improvement number: tasks that were unanswerable and now aren't,
 * without losing groundedness.
 */
export function summarize(results: readonly TaskResult[]) {
  // Everything below is scored over the tasks that actually ran. A task that
  // errored is counted separately rather than as a failure: the surface did not
  // get the chance to answer it, and scoring it zero would blame the tools for
  // an Azure timeout.
  const notMeasured = results.filter((result) => result.error);
  const measured = results.filter((result) => !result.error);
  // A refusal is grounded by definition, so grounding is scored only over answers
  // that claim something: a server that refused everything would otherwise score 100%.
  const claimed = measured.filter((result) => result.madeClaims ?? true);
  const grounded = claimed.filter((result) => result.grounded).length;
  const blocked = measured.filter((result) => result.expected === "blocked");
  const answeredBlocked = blocked.filter((result) => result.answered && result.grounded).length;
  const regressions = measured.filter((result) => result.expected === "pass" && !result.answered);

  return {
    tasks: measured.length,
    // Non-zero means this run does not cover the whole corpus, so it is not
    // comparable with one that does.
    notMeasured: notMeasured.length,
    ...(notMeasured.length && { notMeasuredIds: notMeasured.map((result) => result.id) }),
    answered: measured.filter((result) => result.answered).length,
    /** Answers that state a figure, name or conclusion: the denominator of `grounded`. */
    claimed: claimed.length,
    grounded,
    /** Answers that claim nothing: refusals and requests for clarification. */
    refusals: measured.length - claimed.length,
    fabricationRate: claimed.length ? (claimed.length - grounded) / claimed.length : 0,
    blockedTasks: blocked.length,
    // Blocked tasks answered CORRECTLY (answered AND grounded) — the score phase 2
    // is meant to move. Answering a blocked task ungrounded is a fabrication, not
    // progress, so it deliberately does not count here.
    blockedButAnswered: answeredBlocked,
    // Blocked tasks where the agent said what it could not determine. High is
    // good today: honest failure is the best available behaviour.
    honestRefusals: blocked.filter((result) => !result.answered && result.acknowledgedLimit).length,
    regressions: regressions.map((result) => result.id),
    // What the grounding numbers above were measured over: a fabrication rate judged on
    // abridged views is a weaker claim, so the denominator is stated rather than assumed.
    judgedOnCompleteData: measured.filter((result) => result.judgedOnCompleteData).length,
    totalTokens: measured.reduce((sum, result) => sum + result.tokens, 0),
    totalJudgeTokens: measured.reduce((sum, result) => sum + (result.judgeTokens ?? 0), 0),
    totalToolCalls: measured.reduce((sum, result) => sum + result.toolsCalled.length, 0),
    failedToolCalls: measured.reduce((sum, result) => sum + (result.failedToolCalls ?? 0), 0),
    totalUpstreamRequests: measured.reduce(
      (sum, result) => sum + (result.upstreamRequests ?? 0),
      0
    ),
    toolFriction: rollUpToolFriction(measured),
  };
}

/** The report `capability.test.ts` writes and `compare.ts` reads. */
export interface CapabilityReport {
  generatedAt: string;
  mode: ToolMode;
  /**
   * `root` is relative to the repository, so a report names no local path.
   * `commit` is the target's HEAD and `harnessCommit` this tree's, each `+dirty` with
   * uncommitted changes; both absent on older reports.
   */
  target: {
    label: string;
    root: string;
    baseline: boolean;
    commit?: string;
    harnessCommit?: string;
  };
  /** Empty when no model was configured. */
  model: string;
  /** Empty when no judge was configured. */
  judgeModel: string;
  /** How the agent and the judge were driven; absent on older reports. */
  settings?: {
    provider: ProviderId | null;
    judgeProvider: ProviderId | null;
    temperature: number;
    maxSteps: number;
    serverInstructions: boolean;
  };
  /** Which task set ran; absent on reports from before `demanding` existed. */
  corpus?: Corpus;
  /** The ids `EVAL_TASK_IDS` selected; present only when they are part of the corpus. */
  taskFilter?: string[];
  /** Present on a run capped by `EVAL_MAX_TOKENS`; `unrun` lists the tasks the cap skipped. */
  budget?: { maxTokens: number; spentTokens: number; unrun: string[] };
  summary: ReturnType<typeof summarize>;
  /** The metrics from the judge's answers to the review form; absent on older reports. */
  metrics?: Metrics;
  results: TaskResult[];
}
