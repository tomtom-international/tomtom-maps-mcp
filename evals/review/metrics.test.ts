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
import { computeMetrics, type FinalLabels, finalLabels } from "./metrics";
import type { Labels, Review } from "./reviews";
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
      { transcript: transcript("pass"), labels: final() },
      {
        transcript: transcript("fail"),
        labels: final({
          answered: false,
          outcome: "wrong",
          misled: "badly",
          wentWrong: ["wrong-unit"],
        }),
      },
      {
        transcript: transcript("rubric"),
        labels: final({ answered: false, outcome: "expected-answer-wrong" }),
      },
      {
        transcript: transcript("made-up"),
        labels: final({
          answered: false,
          outcome: "partly-correct",
          grounded: false,
          unsupportedParts: ["42 km"],
        }),
      },
      { transcript: transcript("refusal"), labels: final({ madeClaims: false, toolCalls: [] }) },
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
      {
        transcript: transcript("calls"),
        labels: final({
          toolCalls: [
            "right",
            "acceptable",
            "wrong-inputs",
            "wrong-tool",
            "not-needed",
            "repeated-earlier",
            undefined,
          ],
        }),
      },
    ]);
    expect(metrics.toolCorrectness).toEqual({ count: 3, of: 4 });
    expect(metrics.argumentCorrectness).toEqual({ count: 2, of: 3 });
    expect(metrics.mcpUse).toEqual({ count: 2, of: 4 });
    expect(metrics.unneededCalls).toEqual({ count: 2, of: 6 });
    expect(metrics).toMatchObject({ repeatedCalls: 1, unsettled: { toolCalls: 1 } });
  });

  it("tells correct refusals from ones a tool could have answered, and outages apart", () => {
    const metrics = computeMetrics([
      {
        transcript: transcript("unsupported", { capability: "unsupported" }),
        labels: final({ madeClaims: false }),
      },
      {
        transcript: transcript("cant"),
        labels: final({ answered: false, outcome: "honestly-cant" }),
      },
      {
        transcript: transcript("outage", { toolCalls: [call("failed")] }),
        labels: final({ answered: false, outcome: "cant-but-could", toolFailure: "told-user" }),
      },
      {
        transcript: transcript("lazy"),
        labels: final({ answered: false, outcome: "cant-but-could" }),
      },
    ]);
    expect(metrics).toMatchObject({
      correctRefusals: 2,
      unwarrantedRefusals: 2,
      unwarrantedAfterFailedCall: 1,
      errorHandling: { "told-user": 1 },
    });
  });
});
