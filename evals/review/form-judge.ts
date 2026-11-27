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
 * The judge: it fills in the review form about one transcript, as a reviewer does, so a capability
 * report's verdicts (`verdictOf`) and metrics mean what they mean on people's labels.
 *
 * - **Shown** what reviewers see: the conversation, rubric and any reference, each tool call as
 *   the review page shows it, the answer, and the tools and instructions the model was given.
 * - **Scored questions first**, in a call of their own: the outcome and where the facts came from,
 *   after writing down each fact with its evidence and the rubric part by part. The rest of the
 *   form in that call made these answers worse on the golden set.
 * - **The rest of the form second**, given the first call's check and answers: per tool call, what
 *   it asked for, what the answer uses of it and whether an earlier call returned it, then the
 *   verdicts. A follow-up the form would not ask, such as what went wrong with a correct answer,
 *   is left out of the schema.
 * - **Told how the page shows things**, never how to grade: a grading rule goes into the form.
 * - **`toolFriction`** after the scored questions: a critique of the tool definitions, asked of the
 *   judge rather than the agent under test, for the reason `evals/README.md` gives.
 */

import { createHash } from "node:crypto";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { JudgeToolView } from "../capability/judge";
import { EVAL_TEMPERATURE, STRICT_SCHEMA } from "../harness/model";
import { totalTokens } from "../vendor/types";
import {
  checkLabels,
  checkScoredLabels,
  judgeFields,
  type Labels,
  labelsSchema,
  REFUSALS,
  REVIEW_FORM,
  ReviewError,
  type ScoredLabels,
  scoredLabelsSchema,
} from "./reviews";
import type { RunContext } from "./runs";

/** Fills in a form again after it breaks one of the form's rules, at most this many times in all. */
const ATTEMPTS = 2;

const { shape } = scoredLabelsSchema;

/**
 * What the judge returns, in the order it writes it: its check first, then the form's answers.
 * Every field is present, so a provider can enforce it.
 */
const formSchema = z.object({
  facts: z.array(z.object({ fact: z.string(), evidence: z.string() })),
  rubricCheck: z.string(),
  outcome: shape.outcome,
  expectedAnswerFix: z.string(),
  fromTools: shape.fromTools,
  unsupportedParts: z.array(z.string()),
  toolFriction: z.array(
    z.object({ tool: z.string(), problem: z.string(), suggestion: z.string() })
  ),
});

export type ToolFriction = z.infer<typeof formSchema>["toolFriction"];

const options = (choices: readonly { value: string; label: string }[]): string =>
  `Options: ${choices.map(({ value, label }) => `"${value}" (${label})`).join(", ")}.`;

const quoted = (values: readonly string[]): string =>
  values.map((value) => `"${value}"`).join(" or ");

const { outcome, fromTools } = REVIEW_FORM;

/** The questions the judge answers, as the form words them, with when each follow-up applies. */
const FORM = [
  `outcome: ${outcome.question} ${outcome.hint} ${options(outcome.options)} With ` +
    `"${outcome.fixWhen}", expectedAnswerFix says what the rubric should say; otherwise it is empty.`,
  `fromTools: ${fromTools.question} ${fromTools.hint} ${options(fromTools.options)} With ` +
    `${quoted(fromTools.pasteWhen)}, unsupportedParts holds each such fact, one per entry; otherwise empty.`,
].join("\n\n");

/** How the review page shows a transcript, which both calls are told. */
const PAGE = [
  "HOW THE PAGE SHOWS THEM",
  "",
  "Tool inputs and outputs too large to show in full are abridged, and every cut is marked in",
  'place: a long array becomes {"count": M, "sample": [...]}, holding its length and first items;',
  'a shortened string ends with "… [+N chars]"; and a value nested deeper than the page goes',
  'becomes the literal string "[nested]". Each tool call\'s header ends in "abridged:", naming its',
  'cuts, or in "complete". The assistant received every call whole: beyond a cut the data exists,',
  "but you cannot see it. A call marked complete is shown whole.",
  "",
  "A REFERENCE ANSWER, on some tasks, was recomputed independently from live data moments after",
  "the run, so the data may have moved slightly since. The assistant never had it.",
];

const INSTRUCTIONS = [
  "You review a recorded answer from an assistant that answers with TomTom map tools, by answering",
  "two questions of the review form reviewers fill in. You see what every reviewer sees: the task,",
  "the conversation, the rubric a correct answer must meet, each tool call the assistant made with",
  "its input and output, the assistant's answer, and under CONTEXT the tools it could use and the",
  "instructions it was given.",
  "",
  ...PAGE,
  "",
  "FIRST, WHAT YOU CHECKED",
  "",
  "Before answering, write down what a careful reviewer checks, and answer from it:",
  "",
  "facts: every fact the answer states, one per entry: each number, name, place, time, status and",
  "conclusion. For each, the evidence: the tool call that shows it, by number, and what in that",
  "call shows it; or that no tool call shows it. An answer with nothing to check, as fromTools",
  "below describes it, has none.",
  "",
  "rubricCheck: what the rubric asks for, part by part, and whether the answer does each.",
  "",
  "THEN THE FORM",
  "",
  FORM,
  "",
  "AFTER THE FORM",
  "",
  "toolFriction: not part of the form, and none of its answers depends on it. Report tool-DEFINITION",
  "problems this transcript exposes: a tool whose description made the assistant pick it wrongly,",
  "whose parameters were unclear, whose result omitted what the question needed, or that was called",
  "pointlessly. Judge the definition, not the assistant. For each, name the tool exactly as the",
  "transcript does, what about its name, description or parameters plausibly caused it, and one",
  "concrete change to the definition. Return an empty list when the tools behaved well; do not",
  "invent friction to fill it.",
].join("\n");

const { toolCalls, missingCall, toolFailure, wentWrong, misled } = REVIEW_FORM;

/** The rest of the form, as it words it, with when each follow-up applies. */
const REST_FORM = [
  `toolCalls: ${toolCalls.question} ${toolCalls.hint} ${options(toolCalls.options)} Each entry ` +
    "of calls answers it for its call, as verdict.",
  `missingCall: ${missingCall.question} ${missingCall.hint} ${options(missingCall.options)} With ` +
    '"yes", missingTool names it, with what it should ask, in one short line of at most 200 ' +
    "characters; otherwise it is empty.",
  `toolFailure, asked only when a tool call failed: ${toolFailure.question} ` +
    options(toolFailure.options),
  `wentWrong, asked only when the outcome is ${quoted(wentWrong.askedWhen)}: ` +
    `${wentWrong.question} ${wentWrong.hint} ${options(wentWrong.options)}`,
  `misled: ${misled.question} ${misled.hint} ${options(misled.options)}`,
].join("\n\n");

const REST_INSTRUCTIONS = [
  "You review a recorded answer from an assistant that answers with TomTom map tools, by answering",
  "the rest of the review form reviewers fill in. You see what every reviewer sees: the task, the",
  "conversation, the rubric a correct answer must meet, each tool call the assistant made with its",
  "input and output, the assistant's answer, and under CONTEXT the tools it could use and the",
  "instructions it was given. THE FORM SO FAR, after the answer, holds the check and the answers",
  "already given about this answer; they stand, and you answer from them too.",
  "",
  ...PAGE,
  "",
  "FIRST, WHAT YOU CHECKED",
  "",
  "Before answering, write down what a careful reviewer checks, and answer from it:",
  "",
  "calls: one entry per tool call, in order, and none when no tool was called. For each: call, its",
  "number; askedFor, what it asked for, in a few words; answerUses, what in the answer comes from",
  'its result, quoted, or "nothing"; earlierCall, the number of an earlier call that had already',
  'returned what this one returned, or "none"; then verdict, its answer to toolCalls below.',
  "",
  "neededButMissing: what the answer or the rubric needed that no tool call returned, and the tool",
  'under CONTEXT that could have returned it; or "none".',
  "",
  "failure, only when a tool call failed: for each failed call, by number, what the assistant did",
  "next and what the answer says about it.",
  "",
  "THEN THE REST OF THE FORM",
  "",
  REST_FORM,
].join("\n");

const { shape: labelShape } = labelsSchema;

/** The second call's answers, with every follow-up; `restSchemaFor` leaves out those not asked. */
const restSchema = z.object({
  calls: z.array(
    z.object({
      call: z.number(),
      askedFor: z.string(),
      answerUses: z.string(),
      earlierCall: z.string(),
      verdict: labelShape.toolCalls.element,
    })
  ),
  neededButMissing: z.string(),
  missingCall: labelShape.missingCall,
  missingTool: z.string(),
  failure: z.string(),
  toolFailure: labelShape.toolFailure.unwrap(),
  wentWrong: z.array(labelShape.wentWrong.unwrap().element),
  misled: labelShape.misled,
});

type RestAnswers = z.infer<typeof restSchema>;

/** The rest of the form as the page would ask it about this answer: follow-ups only where they apply. */
const restSchemaFor = (anyFailed: boolean, scored: ScoredLabels): z.ZodType<Partial<RestAnswers>> =>
  restSchema.omit({
    ...(!anyFailed && { failure: true, toolFailure: true }),
    ...(!wentWrong.askedWhen.some((asked) => asked === scored.outcome) && { wentWrong: true }),
  });

/**
 * Identifies the form judge's instructions and the shape of its answers. Verdicts compared across
 * runs are only comparable under the same one.
 */
export const FORM_JUDGE_VERSION = createHash("sha256")
  .update(INSTRUCTIONS)
  .update(JSON.stringify(z.toJSONSchema(formSchema)))
  .update(REST_INSTRUCTIONS)
  .update(JSON.stringify(z.toJSONSchema(restSchema)))
  .digest("hex")
  .slice(0, 12);

/** What the form judge reads about one task. */
export interface FormJudgeInput {
  /** The task as the page's header shows it, without the model that answered. */
  task: { id: string; capability: string; expected: string };
  /** The user's turns in order; the answer replies to the last. */
  turns: readonly string[];
  rubric: string;
  /** The oracle's answer, on a demanding task. */
  reference?: string;
  toolViews: readonly JudgeToolView[];
  answer: string;
  /** The tools the model was offered and its instructions; absent on runs that did not save them. */
  context?: RunContext;
}

export interface FormVerdict {
  labels: Labels;
  /** The judge's check, the rubric and then each fact with its evidence, as one paragraph. */
  reason: string;
  toolFriction: ToolFriction;
  judgeTokens: number;
}

/** The verdict a capability report keeps per task, worked out from the form. */
export const verdictOf = (labels: ScoredLabels) => ({
  ...judgeFields(labels),
  acknowledgedLimit: REFUSALS.some((outcome) => outcome === labels.outcome),
});

/** The instructions, then the run's context: the same for every task of a run. */
function systemFor(instructions: string, context: RunContext | undefined): string {
  if (!context)
    return `${instructions}\n\nCONTEXT\n\nThis run did not record its tools or instructions.`;
  const tools = context.tools.map(
    (tool) => `--- ${tool.name}\n${tool.description}\nInputs: ${JSON.stringify(tool.inputSchema)}`
  );
  return [
    instructions,
    "CONTEXT",
    `Tools the model could use (${context.tools.length}):\n\n${tools.join("\n\n")}`,
    `Instructions the model got:\n\n${context.system}`,
  ].join("\n\n");
}

function promptFor({ task, turns, rubric, reference, toolViews, answer }: FormJudgeInput): string {
  const calls = toolViews.map(
    (view, index) =>
      `--- tool call ${index + 1} of ${toolViews.length}: ${view.name} [${view.status}] ` +
      `${view.abridged ? `abridged: ${view.abridged}` : "complete"}\n` +
      `Input:\n${view.input}\nOutput:\n${view.output}`
  );
  return [
    `TASK: ${task.id} (${task.capability}, expected: ${task.expected})`,
    turns.length > 1
      ? `CONVERSATION, turn by turn (the answer replies to the last):\n${turns
          .map((turn, index) => `${index + 1}. ${turn}`)
          .join("\n")}`
      : `QUESTION:\n${turns[0]}`,
    `RUBRIC:\n${rubric}`,
    ...(reference ? [`REFERENCE ANSWER:\n${reference}`] : []),
    `TOOL CALLS (${toolViews.length}):\n${calls.join("\n\n") || "No tools were called."}`,
    `ANSWER:\n${answer || "(the assistant produced no text)"}`,
  ].join("\n\n");
}

type FirstAnswers = z.infer<typeof formSchema>;

/**
 * The scored answers as labels, the judge's check and critique dropped, or the rules of the form
 * they break, such as an answer too long.
 */
function scoredFrom(answers: FirstAnswers): ScoredLabels {
  const parsed = scoredLabelsSchema.safeParse(answers);
  if (!parsed.success) throw new ReviewError(issuesOf(parsed.error));
  checkScoredLabels(parsed.data);
  return parsed.data;
}

/** The whole form's labels, or the rules of the form the rest of it breaks. */
function labelsFrom(
  scored: ScoredLabels,
  rest: Partial<RestAnswers>,
  toolViews: readonly JudgeToolView[]
): Labels {
  const parsed = labelsSchema.safeParse({
    ...scored,
    toolCalls: (rest.calls ?? []).map(({ verdict }) => verdict),
    missingCall: rest.missingCall,
    missingTool: rest.missingTool,
    wentWrong: rest.wentWrong ?? [],
    misled: rest.misled,
    ...(rest.toolFailure && { toolFailure: rest.toolFailure }),
  });
  if (!parsed.success) throw new ReviewError(issuesOf(parsed.error));
  checkLabels(parsed.data, { toolCalls: toolViews });
  return parsed.data;
}

const issuesOf = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}.`).join(" ");

const reasonOf = ({ rubricCheck, facts }: FirstAnswers): string =>
  `${rubricCheck} Facts: ${facts.map(({ fact, evidence }) => `${fact} (${evidence})`).join("; ") || "none"}.`;

const labelOf = (choices: readonly { value: string; label: string }[], value: string): string =>
  `"${value}" (${choices.find((choice) => choice.value === value)?.label ?? value})`;

/** The first call's check and answers, as the second call reads them. */
const formSoFar = (first: FirstAnswers, scored: ScoredLabels): string =>
  [
    "THE FORM SO FAR:",
    `facts: ${first.facts.map(({ fact, evidence }) => `${fact} (${evidence})`).join("; ") || "none"}`,
    `rubricCheck: ${first.rubricCheck}`,
    `outcome: ${labelOf(outcome.options, scored.outcome)}`,
    ...(scored.expectedAnswerFix ? [`expectedAnswerFix: ${scored.expectedAnswerFix}`] : []),
    `fromTools: ${labelOf(fromTools.options, scored.fromTools)}`,
    ...scored.unsupportedParts.map((part) => `unsupportedParts: ${part}`),
  ].join("\n");

/**
 * Asks `model` for a form, and fills it in again, the broken rules named, when `read` finds it
 * breaks one of the form's rules.
 */
async function fillIn<Answers, Result>(
  model: LanguageModel,
  request: { schema: z.ZodType<Answers>; system: string; prompt: string },
  read: (answers: Answers) => Result,
  abortSignal: AbortSignal | undefined
): Promise<{ result: Result; answers: Answers; tokens: number }> {
  let tokens = 0;
  let broken = "";
  for (let attempt = 1; ; attempt++) {
    const { object, usage } = await generateObject({
      model,
      schema: request.schema,
      system: request.system,
      prompt: broken
        ? `${request.prompt}\n\nYOUR LAST FORM BROKE THESE RULES OF THE FORM: ${broken} Fill it in again.`
        : request.prompt,
      temperature: EVAL_TEMPERATURE,
      providerOptions: STRICT_SCHEMA,
      abortSignal,
    });
    tokens += totalTokens({
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    });
    try {
      return { result: read(object), answers: object, tokens };
    } catch (error) {
      if (!(error instanceof ReviewError) || attempt >= ATTEMPTS) throw error;
      broken = error.message;
    }
  }
}

/**
 * Fills in the review form about one transcript: the scored questions, then the rest given those
 * answers. A form that breaks one of the form's rules, such as made-up facts left unquoted, is
 * filled in again with the broken rules named.
 */
export async function judgeForm(
  model: LanguageModel,
  input: FormJudgeInput,
  abortSignal?: AbortSignal
): Promise<FormVerdict> {
  const prompt = promptFor(input);
  const first = await fillIn(
    model,
    { schema: formSchema, system: systemFor(INSTRUCTIONS, input.context), prompt },
    scoredFrom,
    abortSignal
  );
  const scored = first.result;
  const anyFailed = input.toolViews.some((view) => view.status === "failed");
  const rest = await fillIn(
    model,
    {
      schema: restSchemaFor(anyFailed, scored),
      system: systemFor(REST_INSTRUCTIONS, input.context),
      prompt: `${prompt}\n\n${formSoFar(first.answers, scored)}`,
    },
    (answers) => labelsFrom(scored, answers, input.toolViews),
    abortSignal
  );
  return {
    labels: rest.result,
    reason: reasonOf(first.answers),
    toolFriction: first.answers.toolFriction,
    judgeTokens: first.tokens + rest.tokens,
  };
}
