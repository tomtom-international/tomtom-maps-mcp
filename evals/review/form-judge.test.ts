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
 */

import { MockLanguageModelV2 } from "ai/test";
import { describe, expect, it } from "vitest";
import { judgeForm, verdictOf } from "./form-judge";
import { REVIEW_FORM, scoredLabelsSchema } from "./reviews";

/** A model that answers each call with the next of `forms`, as JSON. */
const answering = (...forms: unknown[]) => {
  let call = 0;
  return new MockLanguageModelV2({
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(forms[call++]) }],
      finishReason: "stop" as const,
      usage: { inputTokens: 1000, outputTokens: 50, totalTokens: 1050 },
      warnings: [],
    }),
  });
};

const form = (overrides: Record<string, unknown> = {}) => ({
  facts: [{ fact: "42 km", evidence: "call 1: lengthInMeters 42000" }],
  rubricCheck: "Asks for the driving distance in km; the answer gives it.",
  outcome: "correct",
  expectedAnswerFix: "",
  fromTools: "yes",
  unsupportedParts: [],
  toolFriction: [],
  ...overrides,
});

const input = {
  task: { id: "lookup-distance", capability: "lookup", expected: "pass" },
  turns: ["How far is Amsterdam from Utrecht by car?"],
  rubric: "Gives the driving distance in km.",
  toolViews: [
    {
      name: "tomtom-plan-route",
      status: "ok" as const,
      abridged: null,
      input: '{"from":"Amsterdam","to":"Utrecht"}',
      output: '{"lengthInMeters":42000}',
    },
  ],
  answer: "It is 42 km.",
  context: {
    system: "Use the tools.",
    tools: [{ name: "tomtom-plan-route", description: "Plans a route.", inputSchema: {} }],
    filledInLater: false,
  },
};

const textOf = (prompt: unknown): string => JSON.stringify(prompt);
const asText = (text: string): string => JSON.stringify(text).slice(1, -1);

describe("judgeForm", () => {
  it("asks only the scored questions, with the run's tools and the call to judge", async () => {
    const model = answering(form());
    const verdict = await judgeForm(model, input);

    expect(verdict).toEqual({
      labels: { outcome: "correct", expectedAnswerFix: "", fromTools: "yes", unsupportedParts: [] },
      reason:
        "Asks for the driving distance in km; the answer gives it. " +
        "Facts: 42 km (call 1: lengthInMeters 42000).",
      toolFriction: [],
      judgeTokens: 1050,
    });
    const [system, user] = model.doGenerateCalls[0].prompt;
    for (const asked of [REVIEW_FORM.outcome, REVIEW_FORM.fromTools]) {
      expect(textOf(system)).toContain(asText(asked.question));
      expect(textOf(system)).toContain(asText(asked.hint));
    }
    for (const unasked of [REVIEW_FORM.toolCalls, REVIEW_FORM.misled, REVIEW_FORM.missingCall]) {
      expect(textOf(system)).not.toContain(asText(unasked.question));
    }
    expect(textOf(system)).toContain("Plans a route.");
    expect(textOf(user)).toContain("TASK: lookup-distance (lookup, expected: pass)");
    expect(textOf(user)).toContain("tool call 1 of 1: tomtom-plan-route [ok] complete");
  });

  it("has it write down its check before the answers", async () => {
    const model = answering(form());
    await judgeForm(model, input);
    const system = textOf(model.doGenerateCalls[0].prompt[0]);
    expect(system.indexOf("FIRST, WHAT YOU CHECKED")).toBeLessThan(system.indexOf("THEN THE FORM"));
  });

  it("shows a conversation turn by turn and the reference, and says when no context was saved", async () => {
    const model = answering(form());
    await judgeForm(model, {
      ...input,
      turns: ["Plan a route to Utrecht.", "How far is it?"],
      reference: "42 km",
      context: undefined,
    });
    const [system, user] = model.doGenerateCalls[0].prompt.map(textOf);
    expect(user).toContain(
      asText(
        "CONVERSATION, turn by turn (the answer replies to the last):\n" +
          "1. Plan a route to Utrecht.\n2. How far is it?"
      )
    );
    expect(user).toContain(asText("REFERENCE ANSWER:\n42 km"));
    expect(system).toContain("This run did not record its tools or instructions.");
  });

  it("fills the form in again, naming the broken rule, when a follow-up is missing", async () => {
    const model = answering(
      form({ fromTools: "partly" }),
      form({ fromTools: "partly", unsupportedParts: ["open until 22:00"] })
    );
    const verdict = await judgeForm(model, input);

    expect(verdict.labels).toMatchObject({
      fromTools: "partly",
      unsupportedParts: ["open until 22:00"],
    });
    expect(verdict.judgeTokens).toBe(2100);
    expect(textOf(model.doGenerateCalls[1].prompt)).toContain(
      "Paste the parts of the answer that don't come from the tools."
    );
  });

  it("tells it how the page shows an abridged call and a reference", async () => {
    const model = answering(form());
    await judgeForm(model, input);
    const system = textOf(model.doGenerateCalls[0].prompt[0]);
    expect(system).toContain("The assistant received every call whole");
    expect(system).toContain("The assistant never had it.");
  });

  it("fills the form in again when an answer is longer than the form takes", async () => {
    const model = answering(
      form({ outcome: "expected-answer-wrong", expectedAnswerFix: "x".repeat(2001) }),
      form({ outcome: "expected-answer-wrong", expectedAnswerFix: "Accept miles too." })
    );
    const verdict = await judgeForm(model, input);

    expect(verdict.labels.expectedAnswerFix).toBe("Accept miles too.");
    expect(textOf(model.doGenerateCalls[1].prompt)).toContain("expectedAnswerFix: Too big");
  });

  it("keeps the check and the tool critique apart from the labels", async () => {
    const friction = { tool: "tomtom-plan-route", problem: "unclear", suggestion: "say km" };
    const verdict = await judgeForm(answering(form({ toolFriction: [friction] })), input);

    expect(verdict.toolFriction).toEqual([friction]);
    expect(Object.keys(verdict.labels).sort()).toEqual([
      "expectedAnswerFix",
      "fromTools",
      "outcome",
      "unsupportedParts",
    ]);
  });

  it("says when the answer states no facts", async () => {
    const verdict = await judgeForm(answering(form({ facts: [], fromTools: "no-facts" })), input);
    expect(verdict.reason).toMatch(/Facts: none\.$/);
  });

  it("gives up when the second form breaks a rule too", async () => {
    const unquoted = form({ fromTools: "no" });
    await expect(judgeForm(answering(unquoted, unquoted), input)).rejects.toThrow(
      "Paste the parts of the answer that don't come from the tools."
    );
  });
});

describe("verdictOf", () => {
  const labelsOf = (outcome: string, fromTools: string) =>
    scoredLabelsSchema.parse({ ...form({ outcome, fromTools }), unsupportedParts: ["x"] });

  it("passes a correct answer and fails a made-up one", () => {
    expect(verdictOf(labelsOf("correct", "yes"))).toEqual({
      answered: true,
      grounded: true,
      madeClaims: true,
      acknowledgedLimit: false,
    });
    expect(verdictOf(labelsOf("wrong", "partly"))).toMatchObject({
      answered: false,
      grounded: false,
    });
  });

  it("counts a refusal as saying what it could not do, with nothing made up", () => {
    expect(verdictOf(labelsOf("honestly-cant", "no-facts"))).toEqual({
      answered: false,
      grounded: true,
      madeClaims: false,
      acknowledgedLimit: true,
    });
  });
});
