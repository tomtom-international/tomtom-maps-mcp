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
import {
  agreement,
  disputes,
  judgeAgreement,
  labeledTasks,
  reviewerAgreement,
  settledAnswer,
  settledLabels,
} from "./agreement";
import { type Labels, type Review, reviewKey } from "./reviews";
import { answerHash, type RecordedRun, type Transcript } from "./runs";

const transcript = (taskId: string, answered = true): Transcript => ({
  taskId,
  capability: "lookup",
  expected: "pass",
  turns: [`Prompt for ${taskId}`],
  rubric: "Any answer.",
  answer: `Answer to ${taskId}.`,
  toolCalls: [{ name: "tomtom-geocode", status: "ok", abridged: null, input: "{}", output: "{}" }],
  judge: {
    answered,
    grounded: true,
    acknowledgedLimit: false,
    madeClaims: true,
    reason: "",
    judgedOnCompleteData: true,
  },
});

const run: RecordedRun = {
  id: "run",
  model: "gpt-4.1",
  provider: "azure",
  judgeModel: "gpt-5.1",
  temperature: 0,
  maxSteps: 8,
  corpus: "golden",
  commit: "6eb9fdd",
  generatedAt: "2026-11-18T13:01:14.326Z",
  transcripts: [transcript("one"), transcript("two", false), transcript("three")],
};

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

const review = (
  taskId: string,
  given: Labels,
  reviewedAt: string,
  answer = `Answer to ${taskId}.`
): Review => ({
  labels: given,
  comment: "",
  formVersion: 3,
  runId: run.id,
  taskId,
  answerHash: answerHash(answer),
  reviewedAt,
});

const reviews = (...given: Review[]): Record<string, Review> =>
  Object.fromEntries(given.map((entry) => [reviewKey(entry.runId, entry.taskId), entry]));

describe("agreement", () => {
  it("is empty with no pairs", () =>
    expect(agreement([])).toEqual({ items: 0, agreed: 0, kappa: undefined }));

  it("gives kappa 1 for full agreement over two answers", () =>
    expect(
      agreement([
        ["a", "a"],
        ["b", "b"],
      ]).kappa
    ).toBe(1));

  it("leaves kappa undefined when every answer is the same", () =>
    expect(
      agreement([
        ["a", "a"],
        ["a", "a"],
      ])
    ).toEqual({ items: 2, agreed: 2, kappa: undefined }));

  it("works chance agreement out from both sides pooled", () => {
    // Answers: a ×5, b ×3 of 8, so chance is (5/8)² + (3/8)² = 34/64; observed 3/4.
    const result = agreement([
      ["a", "a"],
      ["a", "b"],
      ["b", "b"],
      ["a", "a"],
    ]);
    expect(result.agreed).toBe(3);
    expect(result.kappa).toBeCloseTo((3 / 4 - 34 / 64) / (1 - 34 / 64));
  });

  it("does not depend on the order within a pair", () =>
    expect(
      agreement([
        ["a", "b"],
        ["a", "a"],
      ]).kappa
    ).toBe(
      agreement([
        ["b", "a"],
        ["a", "a"],
      ]).kappa
    ));
});

describe("settledAnswer", () => {
  it.each([
    [["yes", "yes"], "yes"],
    [["yes", "no"], undefined],
    [["yes", "no", "yes"], "yes"],
    [["yes", "no", "maybe"], undefined],
    [["yes"], undefined],
  ])("settles %j as %j", (answers, settled) => expect(settledAnswer(answers)).toBe(settled));
});

describe("labeledTasks", () => {
  it("keeps tasks with a review of this answer, earliest review first", () => {
    const tasks = labeledTasks([run], {
      later: reviews(review("one", labels(), "2026-11-20T10:00:00Z")),
      earlier: reviews(
        review("one", labels(), "2026-11-19T10:00:00Z"),
        review("two", labels(), "2026-11-19T10:00:00Z", "A different answer.")
      ),
    });
    expect(tasks.map((task) => task.transcript.taskId)).toEqual(["one"]);
    expect(tasks[0].reviews.map(({ reviewer }) => reviewer)).toEqual(["earlier", "later"]);
  });
});

describe("reviewerAgreement", () => {
  it("measures each pair on its tasks' first two reviews, and every pair together", () => {
    const tasks = labeledTasks([run], {
      a: reviews(
        review("one", labels(), "2026-11-19T10:00:00Z"),
        review("two", labels({ outcome: "wrong", wentWrong: ["other"] }), "2026-11-19T10:00:00Z")
      ),
      b: reviews(
        review("one", labels(), "2026-11-19T11:00:00Z"),
        review("two", labels(), "2026-11-19T11:00:00Z")
      ),
      // A tiebreak, after the first two: left out of agreement.
      c: reviews(review("two", labels({ outcome: "wrong" }), "2026-11-25T10:00:00Z")),
    });
    const { pairs, overall } = reviewerAgreement(tasks);
    expect(pairs.map(({ reviewers, tasks: count }) => [reviewers, count])).toEqual([
      [["a", "b"], 2],
    ]);
    expect(overall.outcome).toMatchObject({ items: 2, agreed: 1 });
    expect(overall.toolCalls).toMatchObject({ items: 2, agreed: 2 });
  });
});

describe("disputes", () => {
  it("lists splits and single reviews, with who has not labeled the task", () => {
    const tasks = labeledTasks([run], {
      a: reviews(
        review("one", labels(), "2026-11-19T10:00:00Z"),
        review("two", labels({ toolCalls: ["not-needed"] }), "2026-11-19T10:00:00Z"),
        review("three", labels(), "2026-11-19T10:00:00Z")
      ),
      b: reviews(
        review("one", labels(), "2026-11-19T11:00:00Z"),
        review("two", labels({ fromTools: "no-facts" }), "2026-11-19T11:00:00Z")
      ),
    });
    expect(
      disputes(tasks, ["a", "b", "c"]).map(({ task, disputed, tiebreakers }) => [
        task.transcript.taskId,
        disputed,
        tiebreakers,
      ])
    ).toEqual([
      ["two", ["madeClaims", "fromTools", "toolCalls[0]"], ["c"]],
      ["three", [], ["b", "c"]],
    ]);
  });
});

describe("chosen labels", () => {
  const given = {
    a: reviews(review("one", labels(), "2026-11-19T10:00:00Z")),
    b: reviews(
      review("one", labels({ outcome: "wrong", wentWrong: ["other"] }), "2026-11-19T11:00:00Z")
    ),
  };
  const chosen = { [reviewKey(run.id, "one")]: { reviewer: "b", decidedAt: "2026-11-23" } };

  it("settles a task on the chosen reviewer's labels, leaving no dispute", () => {
    const tasks = labeledTasks([run], given, chosen);
    expect(settledLabels(tasks[0])).toMatchObject({ outcome: "wrong", answered: "false" });
    expect(disputes(tasks, ["a", "b", "c"])).toEqual([]);
  });

  it("keeps the split in reviewer agreement", () =>
    expect(reviewerAgreement(labeledTasks([run], given, chosen)).overall.outcome).toMatchObject({
      items: 1,
      agreed: 0,
    }));

  it("applies answers decided over the chosen reviewer's", () => {
    const tasks = labeledTasks([run], given, {
      [reviewKey(run.id, "one")]: {
        reviewer: "b",
        overrides: { outcome: "cant-but-could", fromTools: "no-facts" },
        decidedAt: "2026-11-23",
      },
    });
    expect(settledLabels(tasks[0])).toMatchObject({
      outcome: "cant-but-could",
      fromTools: "no-facts",
      madeClaims: "false",
      misled: "no",
    });
  });

  it("rejects a choice of a reviewer who did not label the task", () =>
    expect(() =>
      labeledTasks([run], given, {
        [reviewKey(run.id, "one")]: { reviewer: "c", decidedAt: "2026-11-23" },
      })
    ).toThrow(/c has no review/));
});

describe("judgeAgreement", () => {
  it("compares the judge with each review and with the settled answer", () => {
    const tasks = labeledTasks([run], {
      a: reviews(
        review("one", labels({ outcome: "wrong", wentWrong: ["other"] }), "2026-11-19T10:00:00Z"),
        review("two", labels(), "2026-11-19T10:00:00Z"),
        review("three", labels(), "2026-11-19T10:00:00Z")
      ),
      b: reviews(
        review("one", labels({ outcome: "wrong", wentWrong: ["other"] }), "2026-11-19T11:00:00Z"),
        review("two", labels(), "2026-11-19T11:00:00Z"),
        review("three", labels({ outcome: "wrong", wentWrong: ["other"] }), "2026-11-19T11:00:00Z")
      ),
    });
    expect(settledLabels(tasks[2]).answered).toBeUndefined();
    const { answered } = judgeAgreement(tasks);
    expect(answered.againstReviews).toMatchObject({ items: 6, agreed: 1 });
    expect(answered.againstSettled).toMatchObject({ items: 2, agreed: 0 });
    expect(answered.judgeTrueSettledFalse).toBe(1);
    expect(answered.judgeFalseSettledTrue).toBe(1);
    expect(answered.unsettled).toBe(1);
  });

  it("compares any judge's verdicts, skipping tasks it has none for", () => {
    const tasks = labeledTasks([run], {
      a: reviews(
        review("one", labels(), "2026-11-19T10:00:00Z"),
        review("two", labels(), "2026-11-19T10:00:00Z")
      ),
      b: reviews(
        review("one", labels(), "2026-11-19T11:00:00Z"),
        review("two", labels(), "2026-11-19T11:00:00Z")
      ),
    });
    const { answered } = judgeAgreement(tasks, (task) =>
      task.transcript.taskId === "one"
        ? { answered: false, grounded: true, madeClaims: true }
        : undefined
    );
    expect(answered.againstSettled).toMatchObject({ items: 1, agreed: 0 });
    expect(answered.judgeFalseSettledTrue).toBe(1);
  });
});
