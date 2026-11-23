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
 * The answer-quality metrics, computed from review labels: each task's final labels, from the
 * reviewers on the golden set, or from a judge that fills in the same form.
 *
 * Tool calls are counted by their verdicts:
 *
 * | Metric | Counts | Out of |
 * | --- | --- | --- |
 * | Tool correctness | Right, Acceptable, Wrong inputs | calls with a verdict on the tool: all but Not needed and Repeat |
 * | Argument correctness | Right, Acceptable | calls with the right tool |
 * | MCP Use | Right, Acceptable | calls with a verdict on the tool |
 * | Step efficiency | Not needed, Repeat | every call |
 */

import { type LabeledTask, settledAnswer } from "./agreement";
import { judgeFields, type Labels } from "./reviews";
import type { Transcript } from "./runs";

type Outcome = Labels["outcome"];
type CallVerdict = Labels["toolCalls"][number];

/** A task's labels after settling; a question its reviewers split on is undefined. */
export interface FinalLabels {
  /** The judge's fields, settled on their own: reviewers can agree an answer fails, and split on why. */
  answered: boolean | undefined;
  grounded: boolean | undefined;
  madeClaims: boolean | undefined;
  outcome: Outcome | undefined;
  missingCall: Labels["missingCall"] | undefined;
  misled: Labels["misled"] | undefined;
  /** One per tool call, in call order. */
  toolCalls: (CallVerdict | undefined)[];
  /** Undefined too when no tool call failed, which the transcript shows. */
  toolFailure: Labels["toolFailure"];
  /** The reasons most reviewers gave. */
  wentWrong: Labels["wentWrong"];
  /** Every part of the answer a reviewer quoted as not coming from the tools. */
  unsupportedParts: string[];
}

export interface Count {
  count: number;
  of: number;
}

export interface Metrics {
  tasks: number;
  /** Answers that meet the rubric, out of those whose rubric reviewers accept. */
  taskCompletion: Count;
  partlyCorrect: number;
  rubricWrong: number;
  /** Refused because no tool could answer: "the tools really can't", or Yes on an unsupported task. */
  correctRefusals: number;
  /** Refused although a tool could have answered. */
  unwarrantedRefusals: number;
  /** Of the unwarranted refusals, those after a failed tool call, such as an outage. */
  unwarrantedAfterFailedCall: number;
  /** Each reason most reviewers gave, over the answers that fail. */
  failureTypes: Record<string, number>;
  /** Answers whose facts all come from the tools, out of the answers that state facts. */
  faithfulness: Count;
  answersWithoutFacts: number;
  /** The quoted parts of each answer reviewers found not to come from the tools. */
  madeUpFacts: { taskId: string; parts: string[] }[];
  /** How badly each answer that fails would mislead a user. */
  harm: Record<string, number>;
  toolCorrectness: Count;
  argumentCorrectness: Count;
  mcpUse: Count;
  missedCalls: Count;
  /** Calls that were not needed or repeated an earlier one, out of every settled call. */
  unneededCalls: Count;
  repeatedCalls: number;
  /** What the model did after a failed tool call, over the tasks with one. */
  errorHandling: Record<string, number>;
  /** Answers to a question, or tool calls, left unsettled by a split. */
  unsettled: {
    answered: number;
    grounded: number;
    outcome: number;
    misled: number;
    toolCalls: number;
  };
}

const RIGHT_TOOL: readonly CallVerdict[] = ["right", "acceptable", "wrong-inputs"];
const RIGHT_INPUTS: readonly CallVerdict[] = ["right", "acceptable"];
const UNNEEDED: readonly CallVerdict[] = ["not-needed", "repeated-earlier"];

/** The task's final labels: the chosen reviewer's, or what most of its reviewers answered. */
export function finalLabels(task: LabeledTask): FinalLabels {
  const labels = task.chosen ? [task.chosen] : task.reviews.map(({ review }) => review.labels);
  const settle = <Answer extends string>(answers: readonly Answer[]): Answer | undefined =>
    task.chosen ? answers[0] : settledAnswer(answers);
  const settleFlag = (picked: (labels: Labels) => boolean): boolean | undefined => {
    const settled = settle(labels.map((each) => String(picked(each))));
    return settled === undefined ? undefined : settled === "true";
  };
  const reasons = [...new Set(labels.flatMap((each) => each.wentWrong))];
  return {
    answered: settleFlag((each) => judgeFields(each).answered),
    grounded: settleFlag((each) => judgeFields(each).grounded),
    madeClaims: settleFlag((each) => judgeFields(each).madeClaims),
    outcome: settle(labels.map((each) => each.outcome)),
    missingCall: settle(labels.map((each) => each.missingCall)),
    misled: settle(labels.map((each) => each.misled)),
    toolCalls: task.transcript.toolCalls.map((_, index) =>
      settle(labels.map((each) => each.toolCalls[index]))
    ),
    toolFailure: settle(labels.flatMap((each) => (each.toolFailure ? [each.toolFailure] : []))),
    wentWrong: reasons.filter((reason) => settleFlag((each) => each.wentWrong.includes(reason))),
    unsupportedParts: [...new Set(labels.flatMap((each) => each.unsupportedParts))],
  };
}

const count = <Item>(items: readonly Item[], counted: (item: Item) => boolean): number =>
  items.filter(counted).length;

const tally = (answers: readonly string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const answer of answers) counts[answer] = (counts[answer] ?? 0) + 1;
  return counts;
};

/** The metrics over `tasks`, each a transcript with its final labels. */
export function computeMetrics(
  tasks: readonly { transcript: Transcript; labels: FinalLabels }[]
): Metrics {
  const rubricWrong = count(tasks, ({ labels }) => labels.outcome === "expected-answer-wrong");
  const scored = tasks.filter(
    ({ labels }) => labels.answered !== undefined && labels.outcome !== "expected-answer-wrong"
  );
  const unwarranted = tasks.filter(({ labels }) => labels.outcome === "cant-but-could");
  const failed = scored.filter(({ labels }) => labels.answered === false);
  const statingFacts = tasks.filter(
    ({ labels }) => labels.madeClaims === true && labels.grounded !== undefined
  );
  const calls = tasks.flatMap(({ labels }) => labels.toolCalls);
  const settledCalls = calls.filter((verdict): verdict is CallVerdict => verdict !== undefined);
  const judgedOnTool = settledCalls.filter((verdict) => !UNNEEDED.includes(verdict));
  const rightTool = judgedOnTool.filter((verdict) => RIGHT_TOOL.includes(verdict));
  const rightInputs = judgedOnTool.filter((verdict) => RIGHT_INPUTS.includes(verdict));
  const withFailedCall = tasks.filter(({ transcript }) =>
    transcript.toolCalls.some((call) => call.status === "failed")
  );
  const missingSettled = tasks.filter(({ labels }) => labels.missingCall !== undefined);

  return {
    tasks: tasks.length,
    taskCompletion: {
      count: count(scored, ({ labels }) => labels.answered === true),
      of: scored.length,
    },
    partlyCorrect: count(scored, ({ labels }) => labels.outcome === "partly-correct"),
    rubricWrong,
    correctRefusals: count(
      tasks,
      ({ transcript, labels }) =>
        labels.outcome === "honestly-cant" ||
        (labels.outcome === "correct" && transcript.capability === "unsupported")
    ),
    unwarrantedRefusals: unwarranted.length,
    unwarrantedAfterFailedCall: count(unwarranted, ({ transcript }) =>
      transcript.toolCalls.some((call) => call.status === "failed")
    ),
    failureTypes: tally(failed.flatMap(({ labels }) => labels.wentWrong)),
    faithfulness: {
      count: count(statingFacts, ({ labels }) => labels.grounded === true),
      of: statingFacts.length,
    },
    answersWithoutFacts: count(tasks, ({ labels }) => labels.madeClaims === false),
    madeUpFacts: tasks
      .filter(({ labels }) => labels.grounded === false && labels.unsupportedParts.length)
      .map(({ transcript, labels }) => ({
        taskId: transcript.taskId,
        parts: labels.unsupportedParts,
      })),
    harm: tally(failed.flatMap(({ labels }) => (labels.misled ? [labels.misled] : []))),
    toolCorrectness: { count: rightTool.length, of: judgedOnTool.length },
    argumentCorrectness: { count: rightInputs.length, of: rightTool.length },
    mcpUse: { count: rightInputs.length, of: judgedOnTool.length },
    missedCalls: {
      count: count(missingSettled, ({ labels }) => labels.missingCall === "yes"),
      of: missingSettled.length,
    },
    unneededCalls: {
      count: count(settledCalls, (verdict) => UNNEEDED.includes(verdict)),
      of: settledCalls.length,
    },
    repeatedCalls: count(settledCalls, (verdict) => verdict === "repeated-earlier"),
    errorHandling: tally(
      withFailedCall.flatMap(({ labels }) => (labels.toolFailure ? [labels.toolFailure] : []))
    ),
    unsettled: {
      answered: count(tasks, ({ labels }) => labels.answered === undefined),
      grounded: count(tasks, ({ labels }) => labels.grounded === undefined),
      outcome: count(tasks, ({ labels }) => labels.outcome === undefined),
      misled: count(tasks, ({ labels }) => labels.misled === undefined),
      toolCalls: calls.length - settledCalls.length,
    },
  };
}
