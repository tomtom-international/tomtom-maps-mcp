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
 * People's labels on recorded runs: one file per reviewer, one review per run and task.
 *
 * Reviewers record what happened, not scores: how the answer turned out, a verdict per tool
 * call, whether its facts came from the tools. The metrics, and the judge's fields to compare
 * against offline (`judgeFields`), are computed from those. Reviewers never see the judge.
 * What code works out from the run itself (the number of calls, failed calls) is not asked.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  answerHash,
  type JudgeVerdict,
  type ReviewableRun,
  type ReviewableTranscript,
} from "./runs";

/** Where labels live, one `<reviewer>.json` each. */
export const REVIEWS_DIRECTORY = path.resolve(import.meta.dirname, "../golden/reviews");

/** Raised when a review is a valid shape but does not fit its transcript. */
export class ReviewError extends Error {}

/** A question's value and the words the form shows for it, in the order the form lists them. */
const choices = <const Value extends string>(options: Record<Value, string>) => ({
  schema: z.enum(Object.keys(options) as [Value, ...Value[]]),
  options: Object.entries<string>(options).map(([value, label]) => ({ value, label })),
});

const OUTCOME = choices({
  correct: "Yes",
  "partly-correct": "Partly",
  wrong: "No",
  "honestly-cant": "Refused: the tools really can't",
  "cant-but-could": "Refused: the tools could have",
  "asked-whats-meant": "Asked what's meant",
  "expected-answer-wrong": "The rubric is wrong",
});

const TOOL_CALL = choices({
  right: "Right",
  acceptable: "Acceptable",
  "wrong-inputs": "Wrong inputs",
  "wrong-tool": "Wrong tool",
  "not-needed": "Not needed",
  "repeated-earlier": "Repeat",
});

const MISSING_CALL = choices({ no: "No", yes: "Yes" });

const FROM_TOOLS = choices({
  yes: "Yes, all of it",
  partly: "Partly",
  no: "No, none of it",
  "no-facts": "It states no facts",
});

const WENT_WRONG = choices({
  "wrong-number": "Wrong number",
  "wrong-unit": "Wrong unit",
  "missing-part": "Left part out",
  "wrong-place": "Wrong place or road",
  "misread-tool-result": "Misread a tool result",
  other: "Other (say in the comment)",
});

const MISLED = choices({ no: "No", "a-little": "A little", badly: "Badly" });

const TOOL_FAILURE = choices({
  retried: "Retried sensibly",
  "told-user": "Told the user",
  ignored: "Ignored it",
  "made-up": "Made up a result",
});

/** Outcomes that are a refusal: the assistant said it cannot answer. */
export const REFUSALS = ["honestly-cant", "cant-but-could"] as const;

/** Outcomes that ask what went wrong. */
const NOT_CORRECT = ["partly-correct", "wrong", "cant-but-could"] as const;

/** Where-from answers that ask for the unsupported parts. */
const NOT_FROM_TOOLS = ["partly", "no"] as const;

const text = (max: number) => z.string().trim().max(max).default("");

export const labelsSchema = z.object({
  outcome: OUTCOME.schema,
  /** What the rubric should say; required with `expected-answer-wrong`. */
  expectedAnswerFix: text(2000),
  /** One verdict per tool call, in call order. */
  toolCalls: z.array(TOOL_CALL.schema).max(100),
  missingCall: MISSING_CALL.schema,
  missingTool: text(200),
  fromTools: FROM_TOOLS.schema,
  /** The parts of the answer no tool result supports, as quoted from it. */
  unsupportedParts: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  /** Asked only when the outcome is not correct. */
  wentWrong: z.array(WENT_WRONG.schema).max(WENT_WRONG.options.length).default([]),
  misled: MISLED.schema,
  /** Asked only when a tool call failed. */
  toolFailure: TOOL_FAILURE.schema.optional(),
});

export type Labels = z.infer<typeof labelsSchema>;

/** The answers the scores are worked out from: the outcome, where the facts came from, and their follow-ups. */
export const scoredLabelsSchema = labelsSchema.pick({
  outcome: true,
  expectedAnswerFix: true,
  fromTools: true,
  unsupportedParts: true,
});

export type ScoredLabels = z.infer<typeof scoredLabelsSchema>;

/** A form's answers: every question, or the scored ones alone, as on judge reports before it answered the rest. */
export const formAnswersSchema = labelsSchema.partial().extend(scoredLabelsSchema.shape);

export type FormAnswers = z.infer<typeof formAnswersSchema>;

/** The labels the agreement report compares across reviewers; none of them has a default. */
export const comparedLabelsSchema = labelsSchema.pick({
  outcome: true,
  fromTools: true,
  missingCall: true,
  misled: true,
});

/** The questions, their hints and options, in the order a reviewer is asked them. */
export const REVIEW_FORM = {
  outcome: {
    question: "Does the answer meet the rubric?",
    hint:
      "A refusal the rubric asks for, as in every unsupported task, is Yes. The two Refused " +
      "answers are for a rubric that wanted an answer: pick 'the tools really can't' when the " +
      "context shows no tool could give it, and 'the tools could have' when one could. A failed " +
      "tool call is no excuse: an answer that says it couldn't get the data is not Yes, and when " +
      "the right tool failed because the service was down, it is 'the tools could have'. 'The " +
      "rubric is wrong' asks what it should say.",
    options: OUTCOME.options,
    /** The outcome that asks what the rubric should say. */
    fixWhen: "expected-answer-wrong",
  },
  wentWrong: {
    question: "What went wrong?",
    hint: "Pick every one that applies.",
    options: WENT_WRONG.options,
    askedWhen: NOT_CORRECT,
  },
  fromTools: {
    question: "Does the answer come from the tool results?",
    hint:
      "Arithmetic and unit conversion on tool data count as from the tools, and so do " +
      "coordinates written latitude first against the tools' [longitude, latitude]; general " +
      "knowledge does not. A tool call marked abridged was cut for this page, not for the model: " +
      "a fact you can't find in a cut part is not unsupported for that alone, but one that " +
      "contradicts what is shown is. For Partly or None of it, paste each fact that doesn't, one " +
      "fact per line. 'It states " +
      "no facts' is an answer with nothing to check: a plain refusal, or one that only says what " +
      "the tools can't do or that a tool call failed.",
    options: FROM_TOOLS.options,
    pasteWhen: NOT_FROM_TOOLS,
  },
  toolCalls: {
    question: "Was each tool call right?",
    hint:
      "Right: the call you would make. Acceptable: it works, but a better call exists. Wrong " +
      "inputs: the right tool asked for the wrong thing, such as the wrong place or radius. " +
      "Not needed: the answer uses nothing it returned. Repeat: it looks up what an earlier " +
      "call already returned. The tools and what each takes " +
      "are under Context.",
    options: TOOL_CALL.options,
  },
  missingCall: {
    question: "Was a needed tool call missing?",
    hint: "A call the answer needed and the model never made. Name it, with what it should ask.",
    options: MISSING_CALL.options,
  },
  toolFailure: {
    question: "A tool call failed. What did the model do?",
    hint: "",
    options: TOOL_FAILURE.options,
  },
  misled: {
    question: "Would a user be misled?",
    hint:
      "A little: a detail is off, but they would still get what they need. Badly: they would " +
      "act on something false.",
    options: MISLED.options,
  },
};

/** A question of the review form. */
export type FormQuestion = keyof typeof REVIEW_FORM;

/** The questions the scores come from, which the judge (`form-judge.ts`) answers first. */
const SCORED_QUESTIONS: readonly FormQuestion[] = ["outcome", "fromTools"];

/**
 * The questions a set of forms answers: every one, or only the scored ones, as the judge's forms
 * did before it answered the whole form. Every full form answers `misled`.
 */
export const questionsAnswered = (forms: readonly FormAnswers[]): readonly FormQuestion[] =>
  forms.some((form) => form.misled !== undefined)
    ? (Object.keys(REVIEW_FORM) as FormQuestion[])
    : SCORED_QUESTIONS;

/** Bumped when a question changes meaning; added questions keep the version. */
const FORM_VERSION = 3;

const reviewInputSchema = z.object({ labels: labelsSchema, comment: text(4000) });

const reviewSchema = reviewInputSchema.extend({
  formVersion: z.literal(FORM_VERSION),
  runId: z.string(),
  taskId: z.string(),
  /** The answer the labels were given for; a different answer leaves them unmatched. */
  answerHash: z.string(),
  reviewedAt: z.string(),
});

export type Review = z.infer<typeof reviewSchema>;

const reviewerFileSchema = z.object({
  reviewer: z.string(),
  reviews: z.record(z.string(), reviewSchema),
});

/** Every rule that ties the labels to their transcript; throws `ReviewError` listing the broken ones. */
export function checkLabels(
  labels: Labels,
  transcript: { toolCalls: readonly Pick<ReviewableTranscript["toolCalls"][number], "status">[] }
): void {
  const calls = transcript.toolCalls.length;
  const anyFailed = transcript.toolCalls.some((call) => call.status === "failed");
  const problems = [
    labels.toolCalls.length !== calls &&
      `toolCalls has ${labels.toolCalls.length} answers for ${calls} tool call(s).`,
    ...scoredProblems(labels),
    labels.missingCall === "yes" && !labels.missingTool && "Say which tool call was missing.",
    NOT_CORRECT.some((outcome) => outcome === labels.outcome) &&
      !labels.wentWrong.length &&
      "Pick at least one thing that went wrong.",
    anyFailed && !labels.toolFailure && "Say what it did when the tool call failed.",
    !anyFailed && labels.toolFailure && "No tool call failed, so leave out toolFailure.",
  ].filter((problem): problem is string => typeof problem === "string");
  if (problems.length) throw new ReviewError(problems.join(" "));
}

/** The follow-ups the scored answers leave unanswered. */
const scoredProblems = (labels: ScoredLabels): string[] =>
  [
    labels.outcome === "expected-answer-wrong" &&
      !labels.expectedAnswerFix &&
      "Say what the rubric should say.",
    NOT_FROM_TOOLS.some((answer) => answer === labels.fromTools) &&
      !labels.unsupportedParts.length &&
      "Paste the parts of the answer that don't come from the tools.",
  ].filter((problem): problem is string => typeof problem === "string");

/** The rules of the scored answers alone; throws `ReviewError` listing the broken ones. */
export function checkScoredLabels(labels: ScoredLabels): void {
  const problems = scoredProblems(labels);
  if (problems.length) throw new ReviewError(problems.join(" "));
}

/**
 * The judge's fields, worked out from a review, so the two can be compared: `answered` is a
 * correct outcome, `grounded` an answer whose facts all came from the tools.
 */
export function judgeFields(
  labels: ScoredLabels
): Pick<JudgeVerdict, "answered" | "grounded" | "madeClaims"> {
  return {
    answered: labels.outcome === "correct",
    grounded: labels.fromTools === "yes" || labels.fromTools === "no-facts",
    madeClaims: labels.fromTools !== "no-facts",
  };
}

/** A handle, not a name: the repo is public. */
const REVIEWER_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Returns the reviewer handle, or throws when it is not lowercase letters, digits and dashes. */
export function parseReviewer(reviewer: string): string {
  if (!REVIEWER_PATTERN.test(reviewer)) {
    throw new Error(
      "A reviewer is a handle of lowercase letters, digits and dashes, at most 40 long."
    );
  }
  return reviewer;
}

export const reviewKey = (runId: string, taskId: string): string => `${runId}/${taskId}`;

const reviewerFile = (reviewer: string, directory: string): string =>
  path.join(directory, `${parseReviewer(reviewer)}.json`);

/** The handles with a file in `directory`, sorted. */
export function listReviewers(directory = REVIEWS_DIRECTORY): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
    .sort();
}

/** One reviewer's reviews, keyed by `reviewKey`; empty before their first save. */
export function readReviews(
  reviewer: string,
  directory = REVIEWS_DIRECTORY
): Record<string, Review> {
  const file = reviewerFile(reviewer, directory);
  if (!fs.existsSync(file)) return {};
  return reviewerFileSchema.parse(JSON.parse(fs.readFileSync(file, "utf8"))).reviews;
}

/** Validates a submitted review of one task in `run`, saves it over any earlier one, and returns it. */
export function saveReview(
  reviewer: string,
  run: ReviewableRun,
  taskId: string,
  submitted: unknown,
  directory = REVIEWS_DIRECTORY,
  now = new Date()
): Review {
  const transcript = run.transcripts.find((candidate) => candidate.taskId === taskId);
  if (!transcript) throw new ReviewError(`Run "${run.id}" has no task "${taskId}".`);

  const input = reviewInputSchema.parse(submitted);
  checkLabels(input.labels, transcript);
  const review: Review = {
    ...input,
    formVersion: FORM_VERSION,
    runId: run.id,
    taskId,
    answerHash: answerHash(transcript.answer),
    reviewedAt: now.toISOString(),
  };
  const reviews = { ...readReviews(reviewer, directory), [reviewKey(run.id, taskId)]: review };

  fs.mkdirSync(directory, { recursive: true });
  const file = reviewerFile(reviewer, directory);
  const pending = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(pending, `${JSON.stringify({ reviewer, reviews }, null, 2)}\n`);
  fs.renameSync(pending, file);
  return review;
}

/** The review of this exact answer; one given for a different answer to the task does not count. */
export function matchingReview(
  reviews: Record<string, Review>,
  runId: string,
  transcript: ReviewableTranscript
): Review | undefined {
  const review = reviews[reviewKey(runId, transcript.taskId)];
  return review?.answerHash === answerHash(transcript.answer) ? review : undefined;
}
