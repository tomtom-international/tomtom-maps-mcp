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
import { labelsSchema, REVIEW_FORM } from "./reviews";

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
  outcome: "correct",
  expectedAnswerFix: "",
  wentWrong: [],
  fromTools: "yes",
  unsupportedParts: [],
  toolCalls: ["right"],
  missingCall: "no",
  missingTool: "",
  toolFailure: null,
  misled: "no",
  comment: "",
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

describe("judgeForm", () => {
  it("asks the form's own questions, with the run's tools and the call to judge", async () => {
    const model = answering(form());
    const verdict = await judgeForm(model, input);

    expect(verdict).toEqual({
      labels: {
        outcome: "correct",
        expectedAnswerFix: "",
        wentWrong: [],
        fromTools: "yes",
        unsupportedParts: [],
        toolCalls: ["right"],
        missingCall: "no",
        missingTool: "",
        misled: "no",
      },
      comment: "",
      toolFriction: [],
      judgeTokens: 1050,
    });
    const [system, user] = model.doGenerateCalls[0].prompt;
    for (const question of Object.values(REVIEW_FORM)) {
      expect(textOf(system)).toContain(JSON.stringify(question.question).slice(1, -1));
    }
    expect(textOf(system)).toContain("Plans a route.");
    expect(textOf(user)).toContain("TASK: lookup-distance (lookup, expected: pass)");
    expect(textOf(user)).toContain("tool call 1 of 1: tomtom-plan-route [ok] complete");
  });

  it("fills the form in again, naming the broken rule, when a follow-up is missing", async () => {
    const model = answering(
      form({ outcome: "wrong" }),
      form({ outcome: "wrong", wentWrong: ["wrong-number"], misled: "badly" })
    );
    const verdict = await judgeForm(model, input);

    expect(verdict.labels).toMatchObject({ outcome: "wrong", wentWrong: ["wrong-number"] });
    expect(verdict.judgeTokens).toBe(2100);
    expect(textOf(model.doGenerateCalls[1].prompt)).toContain(
      "Pick at least one thing that went wrong."
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
      form({ missingCall: "yes", missingTool: "x".repeat(201) }),
      form({ missingCall: "yes", missingTool: "tomtom-traffic for the A2" })
    );
    const verdict = await judgeForm(model, input);

    expect(verdict.labels.missingTool).toBe("tomtom-traffic for the A2");
    expect(textOf(model.doGenerateCalls[1].prompt)).toContain("missingTool: Too big");
  });

  it("keeps the tool critique apart from the labels", async () => {
    const friction = { tool: "tomtom-plan-route", problem: "unclear", suggestion: "say km" };
    const verdict = await judgeForm(answering(form({ toolFriction: [friction] })), input);

    expect(verdict.toolFriction).toEqual([friction]);
    expect(verdict.labels).not.toHaveProperty("toolFriction");
  });

  it("gives up when the second form breaks a rule too", async () => {
    const tooFew = form({ toolCalls: [] });
    await expect(judgeForm(answering(tooFew, tooFew), input)).rejects.toThrow(
      "toolCalls has 0 answers for 1 tool call(s)."
    );
  });
});

describe("verdictOf", () => {
  const labelsOf = (outcome: string, fromTools: string) => {
    const { comment, toolFriction, toolFailure, ...answers } = form({ outcome, fromTools });
    return labelsSchema.parse(answers);
  };

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
