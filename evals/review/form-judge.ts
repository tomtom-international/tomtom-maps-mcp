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
 * - **Where the facts came from first**, in a call that sees no rubric, reference or task name:
 *   each fact the answer states, its kind, and whether a tool call shows it. The judge does not
 *   pick the form's answer; `whereFrom` works it out from the facts, so the same facts give the
 *   same answer on every repeat. With the rubric in view, the judge marked answers the rubric
 *   fails as made up.
 * - **The rest of the form second**, in one call given those facts and that answer. The outcome
 *   comes first, after the rubric part by part, so nothing asked after it can steer it; then per
 *   tool call what it asked for, what the answer uses of it and whether an earlier call returned
 *   it, and the verdicts. A follow-up the form would not ask, such as what went wrong with a
 *   correct answer, is dropped from its answers.
 * - **Told how the page shows things**, never how to grade: a grading rule goes into the form.
 * - **`toolFriction`** last: a critique of the tool definitions, asked of the judge rather than
 *   the agent under test, for the reason `evals/README.md` gives.
 */

import { createHash } from "node:crypto";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { JudgeToolView } from "../capability/judge";
import { EVAL_TEMPERATURE, STRICT_SCHEMA } from "../harness/model";
import { totalTokens } from "../vendor/types";
import {
  checkLabels,
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

/** A fact's kind: only `data` can be checked against the tool results. */
const FACT_KINDS = ["data", "limit", "advice"] as const;

/** The first call's answers: each fact the answer states, and where it came from. */
const factsSchema = z.object({
  facts: z.array(
    z.object({
      fact: z.string(),
      kind: z.enum(FACT_KINDS),
      evidence: z.string(),
      fromTools: z.boolean(),
    })
  ),
});

type Facts = z.infer<typeof factsSchema>["facts"];

const options = (choices: readonly { value: string; label: string }[]): string =>
  `Options: ${choices.map(({ value, label }) => `"${value}" (${label})`).join(", ")}.`;

const quoted = (values: readonly string[]): string =>
  values.map((value) => `"${value}"`).join(" or ");

const { outcome, fromTools } = REVIEW_FORM;

/** How the review page shows an abridged tool call, which every call is told. */
const ABRIDGED = [
  "HOW THE PAGE SHOWS THEM",
  "",
  "Tool inputs and outputs too large to show in full are abridged, and every cut is marked in",
  'place: a long array becomes {"count": M, "sample": [...]}, holding its length and first items;',
  'a shortened string ends with "… [+N chars]"; and a value nested deeper than the page goes',
  'becomes the literal string "[nested]". Each tool call\'s header ends in "abridged:", naming its',
  'cuts, or in "complete". The assistant received every call whole: beyond a cut the data exists,',
  "but you cannot see it. A call marked complete is shown whole.",
];

/** How the page shows a transcript, for the calls that see the rubric and any reference. */
const PAGE = [
  ...ABRIDGED,
  "",
  "A REFERENCE ANSWER, on some tasks, was recomputed independently from live data moments after",
  "the run, so the data may have moved slightly since. The assistant never had it.",
];

const FACTS_INSTRUCTIONS = [
  "You review a recorded answer from an assistant that answers with TomTom map tools, by checking",
  "where each fact in it came from. You see the conversation, each tool call the assistant made",
  "with its input and output, the assistant's answer, and under CONTEXT the tools it could use and",
  "the instructions it was given. Whether the answer is the right one is not asked here.",
  "",
  ...ABRIDGED,
  "",
  "THE QUESTION",
  "",
  `Reviewers answer "${fromTools.question}" under this hint: ${fromTools.hint}`,
  "",
  "You do not answer it. You write down what it is answered from:",
  "",
  "facts: every fact the answer states, one per entry, in the answer's own words: each number,",
  "name, place, time, status and conclusion. For each:",
  "",
  '- kind: "data" when it says something about the world that a tool result could show or',
  '  contradict; "limit" when it only says what the tools cannot do, or that a tool call failed;',
  '  "advice" when it is a suggestion, a caveat or an offer, with nothing to check.',
  "- evidence: the tool call that shows it, by number, and what in that call shows it; or that no",
  "  tool call shows it.",
  "- fromTools: whether it comes from the tool results, as the hint counts it.",
  "",
  "An answer with nothing to check, as the hint describes it, has no data facts.",
].join("\n");

const { toolCalls, missingCall, toolFailure, wentWrong, misled } = REVIEW_FORM;

/** The questions the second call answers, as the form words them, with when each follow-up applies. */
const FORM = [
  `outcome: ${outcome.question} ${outcome.hint} ${options(outcome.options)} With ` +
    `"${outcome.fixWhen}", expectedAnswerFix says what the rubric should say; otherwise it is empty.`,
  `toolCalls: ${toolCalls.question} ${toolCalls.hint} ${options(toolCalls.options)} Each entry ` +
    "of calls answers it for its call, as verdict.",
  `missingCall: ${missingCall.question} ${missingCall.hint} ${options(missingCall.options)} With ` +
    '"yes", missingTool names it, with what it should ask, in one short line of at most 200 ' +
    "characters; otherwise it is empty.",
  `toolFailure, asked only when a tool call failed: ${toolFailure.question} ` +
    options(toolFailure.options),
  `wentWrong, asked only when the outcome is ${quoted(wentWrong.askedWhen)}, and empty ` +
    `otherwise: ${wentWrong.question} ${wentWrong.hint} ${options(wentWrong.options)}`,
  `misled: ${misled.question} ${misled.hint} ${options(misled.options)}`,
].join("\n\n");

const INSTRUCTIONS = [
  "You review a recorded answer from an assistant that answers with TomTom map tools, by answering",
  "the review form reviewers fill in. You see what every reviewer sees: the task, the",
  "conversation, the rubric a correct answer must meet, each tool call the assistant made with its",
  "input and output, the assistant's answer, and under CONTEXT the tools it could use and the",
  "instructions it was given. THE FORM SO FAR, after the answer, holds each fact the answer states",
  "with the tool call that shows it, and the form's answer to where they came from, already",
  "checked; they stand, and you answer from them too.",
  "",
  ...PAGE,
  "",
  "Answer in the order below. Each answer stands once written: nothing after it changes it.",
  "",
  "rubricCheck: before the outcome, what the rubric asks for, part by part, and whether the answer",
  "does each.",
  "",
  `outcome and expectedAnswerFix, answered from rubricCheck: see THE FORM below.`,
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
  "THE FORM",
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

const { shape: labelShape } = labelsSchema;

/**
 * The second call's answers, in the order the judge writes them: the outcome first, so no later
 * answer can steer it. `formSchemaFor` leaves out the follow-ups about a failed call when none failed.
 */
const formSchema = z.object({
  rubricCheck: z.string(),
  outcome: shape.outcome,
  expectedAnswerFix: z.string(),
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
  toolFriction: z.array(
    z.object({ tool: z.string(), problem: z.string(), suggestion: z.string() })
  ),
});

type FormAnswers = z.infer<typeof formSchema>;
type Asked = Omit<FormAnswers, "failure" | "toolFailure"> &
  Partial<Pick<FormAnswers, "failure" | "toolFailure">>;

export type ToolFriction = FormAnswers["toolFriction"];

/** The form as the page would ask it about this answer: a failed call's follow-ups only with one. */
const formSchemaFor = (anyFailed: boolean): z.ZodType<Asked> =>
  anyFailed ? formSchema : formSchema.omit({ failure: true, toolFailure: true });

/**
 * Identifies the form judge's instructions and the shape of its answers. Verdicts compared across
 * runs are only comparable under the same one.
 */
export const FORM_JUDGE_VERSION = createHash("sha256")
  .update(FACTS_INSTRUCTIONS)
  .update(JSON.stringify(z.toJSONSchema(factsSchema)))
  .update(INSTRUCTIONS)
  .update(JSON.stringify(z.toJSONSchema(formSchema)))
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

/** The transcript as the page shows it; `forFacts` leaves out the task, rubric and reference. */
function promptFor(
  { task, turns, rubric, reference, toolViews, answer }: FormJudgeInput,
  forFacts = false
): string {
  const calls = toolViews.map(
    (view, index) =>
      `--- tool call ${index + 1} of ${toolViews.length}: ${view.name} [${view.status}] ` +
      `${view.abridged ? `abridged: ${view.abridged}` : "complete"}\n` +
      `Input:\n${view.input}\nOutput:\n${view.output}`
  );
  return [
    ...(forFacts ? [] : [`TASK: ${task.id} (${task.capability}, expected: ${task.expected})`]),
    turns.length > 1
      ? `CONVERSATION, turn by turn (the answer replies to the last):\n${turns
          .map((turn, index) => `${index + 1}. ${turn}`)
          .join("\n")}`
      : `QUESTION:\n${turns[0]}`,
    ...(forFacts ? [] : [`RUBRIC:\n${rubric}`]),
    ...(reference && !forFacts ? [`REFERENCE ANSWER:\n${reference}`] : []),
    `TOOL CALLS (${toolViews.length}):\n${calls.join("\n\n") || "No tools were called."}`,
    `ANSWER:\n${answer || "(the assistant produced no text)"}`,
  ].join("\n\n");
}

/** The most unsupported parts the form takes. */
const MOST_PARTS = 50;

type WhereFrom = Pick<ScoredLabels, "fromTools" | "unsupportedParts">;

const whereFromSchema = scoredLabelsSchema.pick({ fromTools: true, unsupportedParts: true });

/**
 * The form's answer to where the facts came from, worked out from the facts: none to check is
 * "no-facts", and otherwise it turns on how many of the data facts no tool call shows, which are
 * the unsupported parts. Throws the rules of the form they break, such as a fact left empty.
 */
export function whereFrom(facts: Facts): WhereFrom {
  const data = facts.filter((fact) => fact.kind === "data");
  const unsupported = data.filter((fact) => !fact.fromTools);
  const parsed = whereFromSchema.safeParse({
    fromTools: !data.length
      ? "no-facts"
      : !unsupported.length
        ? "yes"
        : unsupported.length === data.length
          ? "no"
          : "partly",
    unsupportedParts: unsupported.slice(0, MOST_PARTS).map(({ fact }) => fact.trim().slice(0, 500)),
  });
  if (!parsed.success) throw new ReviewError(issuesOf(parsed.error));
  return parsed.data;
}

/**
 * The whole form's labels from the second call's answers and where the facts came from, the
 * judge's check and critique dropped; or the rules of the form they break, such as an answer too
 * long. What went wrong is kept only for an outcome that asks it, as on the page.
 */
function labelsFrom(answers: Asked, where: WhereFrom, toolViews: readonly JudgeToolView[]): Labels {
  const asksWhatWentWrong = wentWrong.askedWhen.some((asked) => asked === answers.outcome);
  const parsed = labelsSchema.safeParse({
    ...where,
    outcome: answers.outcome,
    expectedAnswerFix: answers.expectedAnswerFix,
    toolCalls: answers.calls.map(({ verdict }) => verdict),
    missingCall: answers.missingCall,
    missingTool: answers.missingTool,
    wentWrong: asksWhatWentWrong ? answers.wentWrong : [],
    misled: answers.misled,
    ...(answers.toolFailure && { toolFailure: answers.toolFailure }),
  });
  if (!parsed.success) throw new ReviewError(issuesOf(parsed.error));
  checkLabels(parsed.data, { toolCalls: toolViews });
  return parsed.data;
}

const issuesOf = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}.`).join(" ");

const listed = (facts: Facts): string =>
  facts.map(({ fact, evidence }) => `${fact} (${evidence})`).join("; ") || "none";

const reasonOf = (rubricCheck: string, facts: Facts): string =>
  `${rubricCheck} Facts: ${listed(facts)}.`;

const labelOf = (choices: readonly { value: string; label: string }[], value: string): string =>
  `"${value}" (${choices.find((choice) => choice.value === value)?.label ?? value})`;

/** The first call's facts and the answer worked out from them, as the second call reads them. */
const formSoFar = (facts: Facts, where: WhereFrom): string =>
  [
    "THE FORM SO FAR:",
    `facts: ${listed(facts)}`,
    `fromTools: ${labelOf(fromTools.options, where.fromTools)}`,
    ...where.unsupportedParts.map((part) => `unsupportedParts: ${part}`),
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
 * Fills in the review form about one transcript: where its facts came from, then the rest of the
 * form given those facts. A form that breaks one of the form's rules, such as a rubric called
 * wrong with no fix, is filled in again with the broken rules named.
 */
export async function judgeForm(
  model: LanguageModel,
  input: FormJudgeInput,
  abortSignal?: AbortSignal
): Promise<FormVerdict> {
  const checked = await fillIn(
    model,
    {
      schema: factsSchema,
      system: systemFor(FACTS_INSTRUCTIONS, input.context),
      prompt: promptFor(input, true),
    },
    ({ facts }) => whereFrom(facts),
    abortSignal
  );
  const { facts } = checked.answers;
  const anyFailed = input.toolViews.some((view) => view.status === "failed");
  const form = await fillIn(
    model,
    {
      schema: formSchemaFor(anyFailed),
      system: systemFor(INSTRUCTIONS, input.context),
      prompt: `${promptFor(input)}\n\n${formSoFar(facts, checked.result)}`,
    },
    (answers) => labelsFrom(answers, checked.result, input.toolViews),
    abortSignal
  );
  return {
    labels: form.result,
    reason: reasonOf(form.answers.rubricCheck, facts),
    toolFriction: form.answers.toolFriction,
    judgeTokens: checked.tokens + form.tokens,
  };
}
