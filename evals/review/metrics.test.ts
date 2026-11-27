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

import { describe, expect, it } from "vitest";
import type { LabeledTask } from "./agreement";
import {
  comparedLabelsOf,
  compareFinalLabels,
  computeMetrics,
  type FinalLabels,
  finalLabels,
  labelConsistency,
  labeledAnswer,
  metricsOfResults,
  settleLabels,
} from "./metrics";
import { metricsTable } from "./metrics-format";
import type { FormAnswers, Labels, Review } from "./reviews";
import type { Transcript } from "./runs";

const call = (status: "ok" | "failed" = "ok") => ({
  name: "tomtom-plan-route",
  status,
  abridged: null,
  input: "{}",
  output: "{}",
});

const transcript = (taskId: string, overrides: Partial<Transcript> = {}): Transcript => ({
  taskId,
  capability: "lookup",
  expected: "pass",
  turns: ["A question"],
  rubric: "Any answer.",
  answer: "An answer.",
  toolCalls: [call()],
  judge: {
    answered: true,
    grounded: true,
    acknowledgedLimit: false,
    madeClaims: true,
    reason: "",
    judgedOnCompleteData: true,
  },
  ...overrides,
});

const labels = (overrides: Partial<Labels> = {}): Labels => ({
  outcome: "correct",
  expectedAnswerFix: "",
  toolCalls: ["right"],
  missingCall: "no",
  missingTool: "",
  fromTools: "yes",
  unsupportedParts: [],
  wentWrong: [],
  misled: "no",
  ...overrides,
});

const task = (given: Labels[], chosen?: Labels, of = transcript("task")): LabeledTask => ({
  runId: "run",
  transcript: of,
  reviews: given.map((each, index) => ({
    reviewer: `reviewer-${index}`,
    review: { labels: each, reviewedAt: `2026-11-19T1${index}:00:00Z` } as Review,
  })),
  chosen,
});

const final = (overrides: Partial<FinalLabels> = {}): FinalLabels => ({
  answered: true,
  grounded: true,
  madeClaims: true,
  outcome: "correct",
  missingCall: "no",
  misled: "no",
  toolCalls: ["right"],
  toolFailure: undefined,
  wentWrong: [],
  unsupportedParts: [],
  ...overrides,
});

describe("finalLabels", () => {
  it("settles pass or fail even when reviewers split on why it failed", () => {
    const settled = finalLabels(
      task([
        labels({ outcome: "wrong", wentWrong: ["wrong-number"] }),
        labels({ outcome: "cant-but-could", wentWrong: ["wrong-number", "other"] }),
      ])
    );
    expect(settled).toMatchObject({
      answered: false,
      outcome: undefined,
      wentWrong: ["wrong-number"],
    });
  });

  it("leaves a split tool call unsettled and keeps every quoted part", () => {
    const settled = finalLabels(
      task([
        labels({ toolCalls: ["right"], fromTools: "partly", unsupportedParts: ["a"] }),
        labels({ toolCalls: ["not-needed"], fromTools: "no", unsupportedParts: ["a", "b"] }),
      ])
    );
    expect(settled).toMatchObject({
      toolCalls: [undefined],
      grounded: false,
      unsupportedParts: ["a", "b"],
    });
  });

  it("takes chosen labels whole", () =>
    expect(
      finalLabels(
        task([labels(), labels()], labels({ outcome: "honestly-cant", fromTools: "no-facts" }))
      )
    ).toMatchObject({ outcome: "honestly-cant", answered: false, madeClaims: false }));
});

describe("computeMetrics", () => {
  it("scores completion over accepted rubrics, and faithfulness over answers that state facts", () => {
    const metrics = computeMetrics([
      labeledAnswer(transcript("pass"), final()),
      labeledAnswer(
        transcript("fail"),
        final({
          answered: false,
          outcome: "wrong",
          misled: "badly",
          wentWrong: ["wrong-unit"],
        })
      ),
      labeledAnswer(
        transcript("rubric"),
        final({ answered: false, outcome: "expected-answer-wrong" })
      ),
      labeledAnswer(
        transcript("made-up"),
        final({
          answered: false,
          outcome: "partly-correct",
          grounded: false,
          unsupportedParts: ["42 km"],
        })
      ),
      labeledAnswer(transcript("refusal"), final({ madeClaims: false, toolCalls: [] })),
    ]);
    expect(metrics.taskCompletion).toEqual({ count: 2, of: 4 });
    expect(metrics).toMatchObject({ partlyCorrect: 1, rubricWrong: 1 });
    expect(metrics.faithfulness).toEqual({ count: 3, of: 4 });
    expect(metrics.answersWithoutFacts).toBe(1);
    expect(metrics.madeUpFacts).toEqual([{ taskId: "made-up", parts: ["42 km"] }]);
    expect(metrics.failureTypes).toEqual({ "wrong-unit": 1 });
    expect(metrics.harm).toEqual({ badly: 1, no: 1 });
  });

  it("counts tool calls by their verdicts", () => {
    const metrics = computeMetrics([
      labeledAnswer(
        transcript("calls"),
        final({
          toolCalls: [
            "right",
            "acceptable",
            "wrong-inputs",
            "wrong-tool",
            "not-needed",
            "repeated-earlier",
            undefined,
          ],
        })
      ),
    ]);
    expect(metrics.toolCorrectness).toEqual({ count: 3, of: 4 });
    expect(metrics.argumentCorrectness).toEqual({ count: 2, of: 3 });
    expect(metrics.mcpUse).toEqual({ count: 2, of: 4 });
    expect(metrics.unneededCalls).toEqual({ count: 2, of: 6 });
    expect(metrics).toMatchObject({ repeatedCalls: 1, unsettled: { toolCalls: 1 } });
  });

  it("tells correct refusals from ones a tool could have answered, and outages apart", () => {
    const metrics = computeMetrics([
      labeledAnswer(
        transcript("unsupported", { capability: "unsupported" }),
        final({ madeClaims: false })
      ),
      labeledAnswer(transcript("cant"), final({ answered: false, outcome: "honestly-cant" })),
      labeledAnswer(
        transcript("outage", { toolCalls: [call("failed")] }),
        final({ answered: false, outcome: "cant-but-could", toolFailure: "told-user" })
      ),
      labeledAnswer(transcript("lazy"), final({ answered: false, outcome: "cant-but-could" })),
    ]);
    expect(metrics).toMatchObject({
      correctRefusals: 2,
      unwarrantedRefusals: 2,
      unwarrantedAfterFailedCall: 1,
      errorHandling: { "told-user": 1 },
    });
  });
});

describe("settleLabels", () => {
  it("takes one form whole, and several by majority", () => {
    const one = [labels({ outcome: "wrong", wentWrong: ["wrong-unit"] })];
    expect(settleLabels(transcript("task"), one, "whole")).toMatchObject({ outcome: "wrong" });
    expect(settleLabels(transcript("task"), one, "majority")).toMatchObject({ outcome: undefined });
  });

  it("leaves unsettled the questions a judge's forms were not asked", () => {
    const scored: FormAnswers = {
      outcome: "wrong",
      expectedAnswerFix: "",
      fromTools: "partly",
      unsupportedParts: ["open until 22:00"],
    };
    expect(settleLabels(transcript("task"), [scored, scored], "majority")).toMatchObject({
      answered: false,
      grounded: false,
      outcome: "wrong",
      missingCall: undefined,
      misled: undefined,
      toolCalls: [undefined],
      toolFailure: undefined,
      wentWrong: [],
    });
  });
});

describe("comparedLabelsOf", () => {
  it("keeps the labels worked out from the questions asked", () => {
    expect(comparedLabelsOf(["outcome", "fromTools"])).toEqual([
      "answered",
      "grounded",
      "madeClaims",
      "outcome",
    ]);
  });
});

describe("metricsTable", () => {
  it("says not asked for the metrics of questions a column's forms were not asked", () => {
    const metrics = computeMetrics([labeledAnswer(transcript("task"), final())]);
    const rows = metricsTable([
      { name: "people", metrics },
      { name: "judge", metrics, asked: ["outcome", "fromTools"] },
    ]).split("\n");
    const row = (name: string) => rows.find((line) => line.startsWith(`| ${name} |`));
    expect(row("Task completion")).not.toContain("not asked");
    expect(row("Tool correctness")).toMatch(/\| 1\/1 \(100%\) \| not asked \|$/);
    expect(row("Unsettled")).toMatch(/calls 0 \| pass\/fail 0, made up 0, outcome 0 \|$/);
  });
});

describe("compareFinalLabels", () => {
  it("compares each question over the tasks both settled, and tool calls one by one", () => {
    const compared = compareFinalLabels([
      {
        expected: final({ toolCalls: ["right", "not-needed"] }),
        actual: final({ toolCalls: ["right", "right"] }),
      },
      {
        expected: final({ answered: false, outcome: "wrong", misled: undefined }),
        actual: final({ answered: false, outcome: "partly-correct" }),
      },
    ]);
    expect(compared.answered).toMatchObject({ items: 2, agreed: 2 });
    expect(compared.outcome).toMatchObject({ items: 2, agreed: 1 });
    expect(compared.misled).toMatchObject({ items: 1, agreed: 1 });
    expect(compared.toolCalls).toMatchObject({ items: 3, agreed: 2 });
  });
});

describe("labelConsistency", () => {
  it("counts the tasks whose forms all agree, per question", () => {
    const steady = labelConsistency([
      { transcript: transcript("same"), forms: [labels(), labels()] },
      {
        transcript: transcript("split"),
        forms: [labels(), labels({ toolCalls: ["acceptable"], misled: "a-little" })],
      },
      { transcript: transcript("once"), forms: [labels()] },
    ]);
    expect(steady.outcome).toEqual({ count: 2, of: 2 });
    expect(steady.toolCalls).toEqual({ count: 1, of: 2 });
    expect(steady.misled).toEqual({ count: 1, of: 2 });
  });
});

describe("metricsOfResults", () => {
  it("scores the results a judge filled the form in about, and only those", () => {
    const metrics = metricsOfResults([
      { id: "pass", capability: "lookup", labels: labels() },
      {
        id: "outage",
        capability: "lookup",
        failedToolCalls: 1,
        labels: labels({
          outcome: "cant-but-could",
          wentWrong: ["other"],
          fromTools: "no-facts",
          toolFailure: "told-user",
        }),
      },
      { id: "unjudged", capability: "lookup" },
    ]);
    expect(metrics).toMatchObject({
      tasks: 2,
      taskCompletion: { count: 1, of: 2 },
      unwarrantedAfterFailedCall: 1,
      errorHandling: { "told-user": 1 },
    });
    expect(metricsOfResults([{ id: "unjudged", capability: "lookup" }])).toBeUndefined();
  });
});
