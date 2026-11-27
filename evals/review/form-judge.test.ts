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
import { judgeForm, verdictOf, whereFrom } from "./form-judge";
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

type Fact = Parameters<typeof whereFrom>[0][number];

const fact = (overrides: Partial<Fact> = {}): Fact => ({
  fact: "42 km",
  kind: "data",
  evidence: "call 1: lengthInMeters 42000",
  fromTools: true,
  ...overrides,
});

/** The first call's answers: the facts. */
const facts = (...listed: unknown[]) => ({ facts: listed });

const madeUp = fact({ fact: "open until 22:00", evidence: "no tool call", fromTools: false });

/** The second call's answers about `input`'s one tool call: the rest of the form. */
const form = (overrides: Record<string, unknown> = {}) => ({
  rubricCheck: "Asks for the driving distance in km; the answer gives it.",
  outcome: "correct",
  expectedAnswerFix: "",
  calls: [
    {
      call: 1,
      askedFor: "the route",
      answerUses: '"42 km"',
      earlierCall: "none",
      verdict: "right",
    },
  ],
  neededButMissing: "none",
  missingCall: "no",
  missingTool: "",
  wentWrong: [],
  misled: "no",
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
const schemaKeys = (model: MockLanguageModelV2, call: number): string[] => {
  const format = model.doGenerateCalls[call].responseFormat;
  return Object.keys(
    (format?.type === "json" && (format.schema as { properties?: object })?.properties) || {}
  );
};
const asText = (text: string): string => JSON.stringify(text).slice(1, -1);

describe("judgeForm", () => {
  it("asks where the facts came from, then the rest of the form given them", async () => {
    const model = answering(facts(fact()), form());
    const verdict = await judgeForm(model, input);

    expect(verdict).toEqual({
      labels: {
        outcome: "correct",
        expectedAnswerFix: "",
        fromTools: "yes",
        unsupportedParts: [],
        toolCalls: ["right"],
        missingCall: "no",
        missingTool: "",
        wentWrong: [],
        misled: "no",
      },
      reason:
        "Asks for the driving distance in km; the answer gives it. " +
        "Facts: 42 km (call 1: lengthInMeters 42000).",
      toolFriction: [],
      judgeTokens: 2100,
    });
    expect(model.doGenerateCalls).toHaveLength(2);
    const [factsSystem, factsUser] = model.doGenerateCalls[0].prompt.map(textOf);
    expect(factsSystem).toContain(asText(REVIEW_FORM.fromTools.question));
    expect(factsSystem).toContain(asText(REVIEW_FORM.fromTools.hint));
    expect(factsSystem).not.toContain(asText(REVIEW_FORM.outcome.question));
    expect(factsSystem).toContain("Plans a route.");
    expect(factsUser).toContain("tool call 1 of 1: tomtom-plan-route [ok] complete");

    const [system, user] = model.doGenerateCalls[1].prompt.map(textOf);
    const asked = [
      REVIEW_FORM.outcome,
      REVIEW_FORM.toolCalls,
      REVIEW_FORM.misled,
      REVIEW_FORM.missingCall,
    ];
    for (const question of asked) {
      expect(system).toContain(asText(question.question));
      expect(system).toContain(asText(question.hint));
    }
    expect(system).not.toContain(asText(REVIEW_FORM.fromTools.hint));
    expect(system).toContain("Plans a route.");
    expect(user).toContain("TASK: lookup-distance (lookup, expected: pass)");
    expect(user).toContain("tool call 1 of 1: tomtom-plan-route [ok] complete");
    expect(user).toContain(
      asText(
        "THE FORM SO FAR:\nfacts: 42 km (call 1: lengthInMeters 42000)\n" +
          'fromTools: "yes" (Yes, all of it)'
      )
    );
  });

  it("checks the facts without the task, the rubric or the reference", async () => {
    const model = answering(facts(fact()), form());
    await judgeForm(model, { ...input, reference: "41.8 km" });
    const [system, user] = model.doGenerateCalls[0].prompt.map(textOf);
    for (const hidden of ["lookup-distance", "expected: pass", "RUBRIC", input.rubric, "41.8 km"]) {
      expect(user).not.toContain(hidden);
    }
    expect(system).not.toContain("REFERENCE ANSWER");
    expect(user).toContain(input.turns[0]);
    expect(user).toContain("It is 42 km.");
  });

  it("has it answer the outcome first, after its check of the rubric", async () => {
    const model = answering(facts(fact()), form());
    await judgeForm(model, input);
    expect(schemaKeys(model, 1).slice(0, 3)).toEqual([
      "rubricCheck",
      "outcome",
      "expectedAnswerFix",
    ]);
    expect(schemaKeys(model, 1).indexOf("calls")).toBeLessThan(
      schemaKeys(model, 1).indexOf("misled")
    );
    expect(schemaKeys(model, 1).at(-1)).toBe("toolFriction");
  });

  it("shows a conversation turn by turn and the reference, and says when no context was saved", async () => {
    const model = answering(facts(fact()), form());
    await judgeForm(model, {
      ...input,
      turns: ["Plan a route to Utrecht.", "How far is it?"],
      reference: "42 km",
      context: undefined,
    });
    const [system, user] = model.doGenerateCalls[1].prompt.map(textOf);
    expect(user).toContain(
      asText(
        "CONVERSATION, turn by turn (the answer replies to the last):\n" +
          "1. Plan a route to Utrecht.\n2. How far is it?"
      )
    );
    expect(user).toContain(asText("REFERENCE ANSWER:\n42 km"));
    expect(system).toContain("This run did not record its tools or instructions.");
  });

  it("works out where the facts came from, and quotes those no tool call shows", async () => {
    const model = answering(facts(fact(), madeUp), form());
    const verdict = await judgeForm(model, input);

    expect(verdict.labels).toMatchObject({
      fromTools: "partly",
      unsupportedParts: ["open until 22:00"],
    });
    expect(textOf(model.doGenerateCalls[1].prompt)).toContain(
      asText('fromTools: "partly" (Partly)\nunsupportedParts: open until 22:00')
    );
  });

  it("checks the facts again, naming the broken rule, when a made-up fact is left empty", async () => {
    const model = answering(facts(fact({ ...madeUp, fact: " " })), facts(madeUp), form());
    const verdict = await judgeForm(model, input);

    expect(verdict.labels).toMatchObject({
      fromTools: "no",
      unsupportedParts: ["open until 22:00"],
    });
    expect(verdict.judgeTokens).toBe(3150);
    expect(textOf(model.doGenerateCalls[1].prompt)).toContain("unsupportedParts.0");
  });

  it("tells both calls how the page shows an abridged call, and the second a reference", async () => {
    const model = answering(facts(fact()), form());
    await judgeForm(model, input);
    const [factsSystem, system] = model.doGenerateCalls.map((call) => textOf(call.prompt[0]));
    for (const each of [factsSystem, system]) {
      expect(each).toContain("The assistant received every call whole");
    }
    expect(system).toContain("The assistant never had it.");
    expect(factsSystem).not.toContain("The assistant never had it.");
  });

  it("fills the form in again when an answer is longer than the form takes", async () => {
    const model = answering(
      facts(fact()),
      form({ outcome: "expected-answer-wrong", expectedAnswerFix: "x".repeat(2001) }),
      form({ outcome: "expected-answer-wrong", expectedAnswerFix: "Accept miles too." })
    );
    const verdict = await judgeForm(model, input);

    expect(verdict.labels.expectedAnswerFix).toBe("Accept miles too.");
    expect(textOf(model.doGenerateCalls[2].prompt)).toContain("expectedAnswerFix: Too big");
  });

  it("keeps the check and the tool critique apart from the labels", async () => {
    const friction = { tool: "tomtom-plan-route", problem: "unclear", suggestion: "say km" };
    const verdict = await judgeForm(
      answering(facts(fact()), form({ toolFriction: [friction] })),
      input
    );

    expect(verdict.toolFriction).toEqual([friction]);
    expect(verdict.reason).not.toContain("the route");
    expect(Object.keys(verdict.labels).sort()).toEqual([
      "expectedAnswerFix",
      "fromTools",
      "misled",
      "missingCall",
      "missingTool",
      "outcome",
      "toolCalls",
      "unsupportedParts",
      "wentWrong",
    ]);
  });

  it("asks what the model did about a failed call only when one failed", async () => {
    const failed = { ...input, toolViews: [{ ...input.toolViews[0], status: "failed" as const }] };
    const model = answering(
      facts(fact()),
      form({
        outcome: "wrong",
        toolFailure: "told-user",
        wentWrong: ["wrong-number"],
        failure: "said so",
      })
    );
    const verdict = await judgeForm(model, failed);

    expect(schemaKeys(model, 1)).toEqual(expect.arrayContaining(["failure", "toolFailure"]));
    expect(verdict.labels).toMatchObject({ toolFailure: "told-user", wentWrong: ["wrong-number"] });

    const answered = answering(facts(fact()), form());
    await judgeForm(answered, input);
    expect(schemaKeys(answered, 1)).not.toEqual(expect.arrayContaining(["failure", "toolFailure"]));
  });

  it("drops what went wrong from an answer whose outcome does not ask it", async () => {
    const verdict = await judgeForm(
      answering(facts(fact()), form({ wentWrong: ["other"] })),
      input
    );
    expect(verdict.labels).toMatchObject({ outcome: "correct", wentWrong: [] });
  });

  it("fills the form in again, naming the broken rules, without checking the facts again", async () => {
    const model = answering(
      facts(fact()),
      form({ outcome: "wrong", calls: [], wentWrong: [] }),
      form({ outcome: "wrong", wentWrong: ["missing-part"] })
    );
    const verdict = await judgeForm(model, input);

    expect(model.doGenerateCalls).toHaveLength(3);
    const retry = textOf(model.doGenerateCalls[2].prompt);
    expect(retry).toContain("toolCalls has 0 answers for 1 tool call(s).");
    expect(retry).toContain("Pick at least one thing that went wrong.");
    expect(verdict.labels).toMatchObject({ toolCalls: ["right"], wentWrong: ["missing-part"] });
  });

  it("says when the answer states no facts", async () => {
    const verdict = await judgeForm(answering(facts(), form()), input);
    expect(verdict.labels.fromTools).toBe("no-facts");
    expect(verdict.reason).toMatch(/Facts: none\.$/);
  });

  it("gives up when the second form breaks a rule too", async () => {
    const unfixed = form({ outcome: "expected-answer-wrong" });
    await expect(judgeForm(answering(facts(fact()), unfixed, unfixed), input)).rejects.toThrow(
      "Say what the rubric should say."
    );
  });
});

describe("whereFrom", () => {
  const limit = fact({ fact: "the service is down", kind: "limit", fromTools: true });
  const advice = fact({ fact: "check closer to the day", kind: "advice", fromTools: false });

  it("counts only data facts, so a failed call reported or a caveat is nothing to check", () => {
    expect(whereFrom([limit, advice])).toEqual({ fromTools: "no-facts", unsupportedParts: [] });
    expect(whereFrom([fact(), advice])).toEqual({ fromTools: "yes", unsupportedParts: [] });
  });

  it("is partly with some data facts unsupported, and no with all of them", () => {
    expect(whereFrom([fact(), madeUp, limit])).toEqual({
      fromTools: "partly",
      unsupportedParts: ["open until 22:00"],
    });
    expect(whereFrom([madeUp, limit]).fromTools).toBe("no");
  });

  it("keeps the unsupported parts within what the form takes", () => {
    const long = Array.from({ length: 60 }, () => ({ ...madeUp, fact: "x".repeat(600) }));
    const { unsupportedParts } = whereFrom(long);
    expect(unsupportedParts).toHaveLength(50);
    expect(unsupportedParts[0]).toHaveLength(500);
  });
});

describe("verdictOf", () => {
  const labelsOf = (outcome: string, fromTools: string) =>
    scoredLabelsSchema.parse({ outcome, fromTools, unsupportedParts: ["x"] });

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
