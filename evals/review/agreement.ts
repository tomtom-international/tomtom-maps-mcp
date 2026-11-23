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
 * How far reviewers agree with each other, and how far the judge agrees with them.
 *
 * Every task is labeled by two reviewers. A split is settled by a reviewer who has not seen the
 * task labeling it too, so reviewer agreement is measured on each task's first two reviews only:
 * the tiebreaks, picked for being disputed, would drag it down. A task's settled answer to a
 * question is what at least two of its reviewers, and more than half, gave, unless the task is in
 * `golden/settled.json`: there whoever settles disputes chose one reviewer's labels as final.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  comparedLabelsSchema,
  judgeFields,
  type Labels,
  listReviewers,
  matchingReview,
  type Review,
  readReviews,
  reviewKey,
} from "./reviews";
import { type JudgeVerdict, listRuns, type RecordedRun, readRun, type Transcript } from "./runs";

/**
 * Where chosen labels live: `reviewKey` → the reviewer whose labels are final for that task, with
 * any answers decided over theirs.
 */
export const SETTLED_FILE = path.resolve(import.meta.dirname, "../golden/settled.json");

const choiceSchema = z.object({
  reviewer: z.string(),
  /** Answers decided over the chosen reviewer's, such as a rule from `labeling-decisions.md`. */
  overrides: comparedLabelsSchema.partial().default({}),
  decidedAt: z.string(),
  note: z.string().optional(),
});

const settledFileSchema = z.record(z.string(), choiceSchema);

export type ChosenLabels = z.input<typeof settledFileSchema>;

/** The questions compared, each read from a review's labels as one answer. */
export const COMPARED_QUESTIONS = {
  outcome: (labels: Labels) => labels.outcome,
  answered: (labels: Labels) => String(judgeFields(labels).answered),
  grounded: (labels: Labels) => String(judgeFields(labels).grounded),
  madeClaims: (labels: Labels) => String(judgeFields(labels).madeClaims),
  fromTools: (labels: Labels) => labels.fromTools,
  missingCall: (labels: Labels) => labels.missingCall,
  misled: (labels: Labels) => labels.misled,
} satisfies Record<string, (labels: Labels) => string>;

export type Question = keyof typeof COMPARED_QUESTIONS;

/** A compared question, or the verdict on one tool call, pooled over calls. */
export type Measure = Question | "toolCalls";

const QUESTIONS = Object.keys(COMPARED_QUESTIONS) as Question[];

export const MEASURES: readonly Measure[] = [...QUESTIONS, "toolCalls"];

/** The questions the judge answers too, under the same name. */
export const JUDGED_QUESTIONS = ["answered", "grounded", "madeClaims"] as const satisfies readonly (
  | Question
  | keyof JudgeVerdict
)[];

export type JudgedQuestion = (typeof JUDGED_QUESTIONS)[number];

/** A recorded task with the reviews given for its answer, earliest first. */
export interface LabeledTask {
  runId: string;
  transcript: Transcript;
  reviews: { reviewer: string; review: Review }[];
  /** The final labels of a task settled by choice: a reviewer's, with any overrides. */
  chosen?: Labels;
}

export interface Agreement {
  items: number;
  agreed: number;
  /** Fleiss' kappa; undefined with no items, or when every answer is the same one. */
  kappa: number | undefined;
}

/** A question where a task's reviewers differ, or a tool call by its position in the run. */
export type DisputedItem = Question | `toolCalls[${number}]`;

export interface Dispute {
  task: LabeledTask;
  /** Empty when the reviewers agree but too few labeled the task to settle it. */
  disputed: DisputedItem[];
  /** Reviewers who have not labeled the task, any of whom can settle it. */
  tiebreakers: string[];
}

export interface JudgeComparison {
  /** The judge against each review on its own, comparable with reviewer agreement. */
  againstReviews: Agreement;
  /** The judge against the settled answer, over the tasks that have one. */
  againstSettled: Agreement;
  /** Settled false where the judge said true: for `answered`, a fail the judge passed. */
  judgeTrueSettledFalse: number;
  judgeFalseSettledTrue: number;
  /** Tasks whose answer to the question is not settled. */
  unsettled: number;
}

/** Pairs every task in `runs` with its reviews; tasks nobody labeled are left out. */
export function labeledTasks(
  runs: readonly RecordedRun[],
  reviewsByReviewer: Readonly<Record<string, Record<string, Review>>>,
  chosenLabels: ChosenLabels = {}
): LabeledTask[] {
  return runs.flatMap((run) =>
    run.transcripts.flatMap((transcript) => {
      const reviews = Object.entries(reviewsByReviewer)
        .map(([reviewer, reviews]) => ({
          reviewer,
          review: matchingReview(reviews, run.id, transcript),
        }))
        .filter((entry): entry is LabeledTask["reviews"][number] => entry.review !== undefined)
        .sort((one, other) => one.review.reviewedAt.localeCompare(other.review.reviewedAt));
      if (!reviews.length) return [];
      const key = reviewKey(run.id, transcript.taskId);
      const choice = chosenLabels[key];
      if (choice === undefined) return [{ runId: run.id, transcript, reviews }];
      const { reviewer, overrides } = choiceSchema.parse(choice);
      const base = reviews.find((entry) => entry.reviewer === reviewer);
      if (!base) {
        throw new Error(
          `${key} is settled on ${reviewer}'s labels, but ${reviewer} has no review of it.`
        );
      }
      const chosen: Labels = { ...base.review.labels, ...overrides };
      return [{ runId: run.id, transcript, reviews, chosen }];
    })
  );
}

/** Every recorded run, the reviewers with a file, and the tasks they labeled, from disk. */
export function loadLabeledTasks(): {
  runs: RecordedRun[];
  reviewers: string[];
  tasks: LabeledTask[];
} {
  const runs = listRuns().map((id) => readRun(id));
  const reviewers = listReviewers();
  const reviews = Object.fromEntries(
    reviewers.map((reviewer) => [reviewer, readReviews(reviewer)])
  );
  const chosen = fs.existsSync(SETTLED_FILE)
    ? settledFileSchema.parse(JSON.parse(fs.readFileSync(SETTLED_FILE, "utf8")))
    : {};
  return { runs, reviewers, tasks: labeledTasks(runs, reviews, chosen) };
}

/**
 * Agreement over pairs of answers to one item. Chance agreement comes from both sides' answers
 * pooled (Fleiss' kappa), so the order within a pair does not matter.
 */
export function agreement(pairs: readonly (readonly [string, string])[]): Agreement {
  const items = pairs.length;
  const agreed = pairs.filter(([one, other]) => one === other).length;
  if (!items) return { items, agreed, kappa: undefined };
  const counts = new Map<string, number>();
  for (const answer of pairs.flat()) counts.set(answer, (counts.get(answer) ?? 0) + 1);
  const byChance = [...counts.values()].reduce((sum, count) => sum + (count / (2 * items)) ** 2, 0);
  return {
    items,
    agreed,
    kappa: byChance === 1 ? undefined : (agreed / items - byChance) / (1 - byChance),
  };
}

/** The answer at least two of `answers`, and more than half, give; otherwise undefined. */
export function settledAnswer<Answer extends string>(
  answers: readonly Answer[]
): Answer | undefined {
  const counts = new Map<Answer, number>();
  for (const answer of answers) counts.set(answer, (counts.get(answer) ?? 0) + 1);
  for (const [answer, count] of counts) {
    if (count >= 2 && count > answers.length / 2) return answer;
  }
  return undefined;
}

const answersTo = (task: LabeledTask, question: Question): string[] =>
  task.reviews.map(({ review }) => COMPARED_QUESTIONS[question](review.labels));

/** `value(key)` under each of `keys`: the one place `Object.fromEntries` needs its keys typed. */
export function recordOf<Key extends string, Value>(
  keys: readonly Key[],
  value: (key: Key) => Value
): Record<Key, Value> {
  return Object.fromEntries(keys.map((key) => [key, value(key)])) as Record<Key, Value>;
}

/** The task's settled answer to each question, undefined where it has none. */
export function settledLabels(task: LabeledTask): Record<Question, string | undefined> {
  const { chosen } = task;
  if (chosen) return recordOf(QUESTIONS, (question) => COMPARED_QUESTIONS[question](chosen));
  return recordOf(QUESTIONS, (question) => settledAnswer(answersTo(task, question)));
}

/** Each measure's pairs of answers from the first two reviews of every task in `tasks`. */
function firstPairAnswers(tasks: readonly LabeledTask[]): Record<Measure, [string, string][]> {
  const pairs = recordOf(MEASURES, (): [string, string][] => []);
  for (const task of tasks) {
    const [first, second] = task.reviews;
    if (!second) continue;
    for (const question of QUESTIONS) {
      const read = COMPARED_QUESTIONS[question];
      pairs[question].push([read(first.review.labels), read(second.review.labels)]);
    }
    first.review.labels.toolCalls.forEach((verdict, index) => {
      pairs.toolCalls.push([verdict, second.review.labels.toolCalls[index]]);
    });
  }
  return pairs;
}

const measureAgreements = (tasks: readonly LabeledTask[]): Record<Measure, Agreement> => {
  const pairs = firstPairAnswers(tasks);
  return recordOf(MEASURES, (measure) => agreement(pairs[measure]));
};

/** Agreement between the first two reviewers of each task, per pair of reviewers and overall. */
export function reviewerAgreement(tasks: readonly LabeledTask[]): {
  pairs: { reviewers: [string, string]; tasks: number; measures: Record<Measure, Agreement> }[];
  overall: Record<Measure, Agreement>;
} {
  const byPair = new Map<string, { reviewers: [string, string]; paired: LabeledTask[] }>();
  for (const task of tasks) {
    const [first, second] = task.reviews;
    if (!second) continue;
    const reviewers: [string, string] =
      first.reviewer < second.reviewer
        ? [first.reviewer, second.reviewer]
        : [second.reviewer, first.reviewer];
    const key = reviewers.join("\n");
    const entry = byPair.get(key) ?? { reviewers, paired: [] };
    entry.paired.push(task);
    byPair.set(key, entry);
  }
  return {
    pairs: [...byPair.entries()]
      .sort(([one], [other]) => one.localeCompare(other))
      .map(([, { reviewers, paired }]) => ({
        reviewers,
        tasks: paired.length,
        measures: measureAgreements(paired),
      })),
    overall: measureAgreements(tasks),
  };
}

/**
 * The tasks a tiebreak would settle: a split on any question or tool call, or a single review.
 * A task settled by choice has none.
 */
export function disputes(tasks: readonly LabeledTask[], reviewers: readonly string[]): Dispute[] {
  return tasks.flatMap((task) => {
    if (task.chosen !== undefined) return [];
    const unsettled = (answers: readonly string[]) =>
      new Set(answers).size > 1 && settledAnswer(answers) === undefined;
    const disputed: DisputedItem[] = [
      ...QUESTIONS.filter((question) => unsettled(answersTo(task, question))),
      ...task.transcript.toolCalls
        .map((_, index) => index)
        .filter((index) =>
          unsettled(task.reviews.map(({ review }) => review.labels.toolCalls[index]))
        )
        .map((index): DisputedItem => `toolCalls[${index}]`),
    ];
    if (!disputed.length && task.reviews.length >= 2) return [];
    const labeled = new Set(task.reviews.map(({ reviewer }) => reviewer));
    return [{ task, disputed, tiebreakers: reviewers.filter((name) => !labeled.has(name)) }];
  });
}

/** A judge's answers to the judged questions. */
export type JudgedVerdict = Pick<JudgeVerdict, JudgedQuestion>;

/**
 * A judge's verdict on each judged question against the reviews and the settled answers: by
 * default the verdict recorded with the run, or `verdictOf`'s; a task it has none for is skipped.
 */
export function judgeAgreement(
  tasks: readonly LabeledTask[],
  verdictOf: (task: LabeledTask) => JudgedVerdict | undefined = (task) => task.transcript.judge
): Record<JudgedQuestion, JudgeComparison> {
  const judgedTasks = tasks.flatMap((task) => {
    const verdict = verdictOf(task);
    return verdict ? [{ task, verdict }] : [];
  });
  const compare = (question: JudgedQuestion): JudgeComparison => {
    const againstReviews: [string, string][] = [];
    const againstSettled: [string, string][] = [];
    for (const { task, verdict } of judgedTasks) {
      const judged = String(verdict[question]);
      for (const answer of answersTo(task, question).slice(0, 2)) {
        againstReviews.push([answer, judged]);
      }
      const settled = settledLabels(task)[question];
      if (settled !== undefined) againstSettled.push([settled, judged]);
    }
    const count = (settled: string, judged: string) =>
      againstSettled.filter((pair) => pair[0] === settled && pair[1] === judged).length;
    return {
      againstReviews: agreement(againstReviews),
      againstSettled: agreement(againstSettled),
      judgeTrueSettledFalse: count("false", "true"),
      judgeFalseSettledTrue: count("true", "false"),
      unsettled: judgedTasks.length - againstSettled.length,
    };
  };
  return recordOf(JUDGED_QUESTIONS, compare);
}
