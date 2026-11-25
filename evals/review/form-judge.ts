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
 * The judge: it answers the review form's scored questions about one transcript, as a reviewer
 * does, so the pass, made-up and refusal verdicts of a capability report (`verdictOf`) mean what
 * they mean on people's labels, and the judge can be compared with the reviewers on each.
 *
 * It is asked only the questions the scores come from: does the answer meet the rubric, and does
 * it come from the tool results. The rest of the form feeds no score, and on the golden set the
 * judge that answered all of it was less consistent and no closer to people. Those questions, each
 * hint and option, are as `REVIEW_FORM` gives them to reviewers, and it sees what they saw: the
 * conversation, the rubric and any reference, each tool call as the review page shows it, the
 * answer, and the tools and instructions the model was given.
 *
 * Before answering it writes down what a careful reviewer checks: each fact the answer states,
 * with the tool call that shows it or that none does, and the rubric part by part. So the answers
 * follow from a check, instead of a check being written after them. Besides that and the form it
 * is told only how the page shows things, never how to grade, so no rule fits it to the tasks it
 * is measured on; to change what it is asked, change the form, for reviewers too.
 *
 * After the form it critiques the tool definitions (`toolFriction`), a question no answer of the
 * form depends on. It is asked of the judge rather than of the agent, deliberately: the agent is
 * the measurement subject, and a "critique your tools" clause in its system prompt would change
 * how it selects them and contaminate the numbers this suite exists to produce. The judge sees the
 * prompt, every tool call and the answer, so it can spot "the description never said this was
 * radius-only" from the outside, in a call made anyway. The idea is the `<feedback>` the vendored
 * mcp-builder harness (`.agents/skills/mcp-builder/scripts/evaluation.py`) asks the model for.
 */

import { createHash } from "node:crypto";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { JudgeToolView } from "../capability/judge";
import { EVAL_TEMPERATURE, STRICT_SCHEMA } from "../harness/model";
import { totalTokens } from "../vendor/types";
import {
  checkScoredLabels,
  type FormQuestion,
  judgeFields,
  REFUSALS,
  REVIEW_FORM,
  ReviewError,
  type ScoredLabels,
  scoredLabelsSchema,
} from "./reviews";
import type { RunContext } from "./runs";

/** Fills in a form again after it breaks one of the form's rules, at most this many times in all. */
const ATTEMPTS = 2;

/** The questions of the review form the judge answers: those the scores come from. */
export const JUDGE_ASKS: readonly FormQuestion[] = ["outcome", "fromTools"];

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

const INSTRUCTIONS = [
  "You review a recorded answer from an assistant that answers with TomTom map tools, by answering",
  "two questions of the review form reviewers fill in. You see what every reviewer sees: the task,",
  "the conversation, the rubric a correct answer must meet, each tool call the assistant made with",
  "its input and output, the assistant's answer, and under CONTEXT the tools it could use and the",
  "instructions it was given.",
  "",
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

/**
 * Identifies the form judge's instructions and the shape of its answers. Verdicts compared across
 * runs are only comparable under the same one.
 */
export const FORM_JUDGE_VERSION = createHash("sha256")
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
  labels: ScoredLabels;
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

/** The instructions, then the run's context: the same for every task of a run, so it caches. */
function systemFor(context: RunContext | undefined): string {
  if (!context)
    return `${INSTRUCTIONS}\n\nCONTEXT\n\nThis run did not record its tools or instructions.`;
  const tools = context.tools.map(
    (tool) => `--- ${tool.name}\n${tool.description}\nInputs: ${JSON.stringify(tool.inputSchema)}`
  );
  return [
    INSTRUCTIONS,
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

/**
 * The form's answers as labels, the judge's check and critique dropped, or the rules of the form
 * they break, such as an answer too long.
 */
function labelsFrom(answers: z.infer<typeof formSchema>): ScoredLabels {
  const parsed = scoredLabelsSchema.safeParse(answers);
  if (!parsed.success) {
    throw new ReviewError(
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}.`).join(" ")
    );
  }
  checkScoredLabels(parsed.data);
  return parsed.data;
}

const reasonOf = ({ rubricCheck, facts }: z.infer<typeof formSchema>): string =>
  `${rubricCheck} Facts: ${facts.map(({ fact, evidence }) => `${fact} (${evidence})`).join("; ") || "none"}.`;

/**
 * Answers the form's scored questions about one transcript. A form that breaks one of the form's
 * rules, such as made-up facts left unquoted, is filled in again with the broken rules named.
 */
export async function judgeForm(
  model: LanguageModel,
  input: FormJudgeInput,
  abortSignal?: AbortSignal
): Promise<FormVerdict> {
  const system = systemFor(input.context);
  const prompt = promptFor(input);
  let judgeTokens = 0;
  let broken = "";
  for (let attempt = 1; ; attempt++) {
    const { object, usage } = await generateObject({
      model,
      schema: formSchema,
      system,
      prompt: broken
        ? `${prompt}\n\nYOUR LAST FORM BROKE THESE RULES OF THE FORM: ${broken} Fill it in again.`
        : prompt,
      temperature: EVAL_TEMPERATURE,
      providerOptions: STRICT_SCHEMA,
      abortSignal,
    });
    judgeTokens += totalTokens({
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    });
    try {
      return {
        labels: labelsFrom(object),
        reason: reasonOf(object),
        toolFriction: object.toolFriction,
        judgeTokens,
      };
    } catch (error) {
      if (!(error instanceof ReviewError) || attempt >= ATTEMPTS) throw error;
      broken = error.message;
    }
  }
}
