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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  judgeFields,
  matchingReview,
  parseReviewer,
  REVIEW_FORM,
  readReviews,
  reviewKey,
  saveReview,
} from "./reviews";
import { listRuns, type RecordedRun, readRun, type Transcript, writeRun } from "./runs";

const transcript: Transcript = {
  taskId: "lookup-route-summary",
  capability: "lookup",
  expected: "pass",
  turns: ["How long is the drive from Amsterdam to Berlin?"],
  rubric: "States a distance of roughly 600-700 km.",
  answer: "About 661 km.",
  toolCalls: [
    {
      name: "tomtom-plan-route",
      status: "ok",
      abridged: null,
      input: '{"locations":[{"query":"Amsterdam"},{"query":"Berlin"}]}',
      output: '{"lengthInMeters":661465}',
    },
  ],
  judge: {
    answered: true,
    grounded: true,
    acknowledgedLimit: false,
    madeClaims: true,
    reason: "Restates the route length.",
    judgedOnCompleteData: true,
  },
};

const { judge: _, ...withoutJudge } = transcript;

const run: RecordedRun = {
  id: "2026-11-10-gpt-4.1-standard",
  model: "gpt-4.1",
  provider: "azure",
  judgeModel: "gpt-5.1",
  temperature: 0,
  maxSteps: 8,
  corpus: "standard",
  commit: "6eb9fdd",
  generatedAt: "2026-11-10T14:58:43.792Z",
  transcripts: [transcript],
};

const labels = {
  outcome: "correct",
  toolCalls: ["right"],
  missingCall: "no",
  fromTools: "yes",
  misled: "no",
};

let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "eval-review-"));
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

describe("parseReviewer", () => {
  it("accepts a handle", () => expect(parseReviewer("rev-a")).toBe("rev-a"));

  it.each(["", "Rev-A", "../escape", "a b", "x".repeat(41)])("rejects %j", (handle) =>
    expect(() => parseReviewer(handle)).toThrow(/handle/)
  );
});

describe("REVIEW_FORM", () => {
  it("asks the agreed questions, each with its options", () => {
    expect(Object.keys(REVIEW_FORM)).toEqual([
      "outcome",
      "wentWrong",
      "fromTools",
      "toolCalls",
      "missingCall",
      "toolFailure",
      "misled",
    ]);
    expect(REVIEW_FORM.fromTools.options.map((option) => option.value)).toContain("no-facts");
  });
});

describe("saveReview and readReviews", () => {
  it("round-trips a review, tied to the answer it was given for", () => {
    const now = new Date("2026-11-16T10:00:00Z");
    const saved = saveReview(
      "rev-a",
      run,
      transcript.taskId,
      { labels: { ...labels, unsupportedParts: [" 661 km "] } },
      directory,
      now
    );

    expect(saved).toMatchObject({
      formVersion: 3,
      runId: run.id,
      taskId: transcript.taskId,
      labels: { unsupportedParts: ["661 km"], wentWrong: [] },
      comment: "",
      reviewedAt: now.toISOString(),
    });
    expect(readReviews("rev-a", directory)).toEqual({
      [reviewKey(run.id, transcript.taskId)]: saved,
    });
  });

  it("keeps other tasks' reviews when saving one", () => {
    const second = { ...transcript, taskId: "lookup-geocode" };
    const both = { ...run, transcripts: [transcript, second] };
    saveReview("rev-a", both, transcript.taskId, { labels }, directory);
    saveReview("rev-a", both, second.taskId, { labels }, directory);

    expect(Object.keys(readReviews("rev-a", directory)).sort()).toEqual([
      reviewKey(run.id, second.taskId),
      reviewKey(run.id, transcript.taskId),
    ]);
  });

  it("returns no reviews before a reviewer's first save", () =>
    expect(readReviews("nobody", directory)).toEqual({}));

  it.each([
    ["a missing question", { ...labels, misled: undefined }, /misled/],
    ["an unknown option", { ...labels, fromTools: "maybe" }, /fromTools/],
    ["one answer too few for the tool calls", { ...labels, toolCalls: [] }, /1 tool call/],
    [
      "a wrong rubric with no fix",
      { ...labels, outcome: "expected-answer-wrong" },
      /rubric should say/,
    ],
    ["a missing call with no tool named", { ...labels, missingCall: "yes" }, /which tool call/],
    ["a wrong answer with nothing picked as wrong", { ...labels, outcome: "wrong" }, /went wrong/],
    [
      "a tool failure when no call failed",
      { ...labels, toolFailure: "ignored" },
      /No tool call failed/,
    ],
  ])("rejects %s", (_case, submitted, message) => {
    expect(() =>
      saveReview("rev-a", run, transcript.taskId, { labels: submitted }, directory)
    ).toThrow(message);
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it("asks what happened only when a tool call failed", () => {
    const failed = {
      ...transcript,
      toolCalls: [{ ...transcript.toolCalls[0], status: "failed" as const }],
    };
    const withFailure = { ...run, transcripts: [failed] };
    expect(() => saveReview("rev-a", withFailure, failed.taskId, { labels }, directory)).toThrow(
      /tool call failed/
    );
    expect(
      saveReview(
        "rev-a",
        withFailure,
        failed.taskId,
        { labels: { ...labels, toolFailure: "told-user" } },
        directory
      ).labels.toolFailure
    ).toBe("told-user");
  });

  it("rejects an unknown task", () =>
    expect(() => saveReview("rev-a", run, "no-such-task", { labels }, directory)).toThrow(
      /no task/
    ));
});

describe("judgeFields", () => {
  it("works out the judge's fields from the outcome and where the facts came from", () => {
    const review = saveReview("rev-a", run, transcript.taskId, { labels }, directory);
    expect(judgeFields(review.labels)).toEqual({
      answered: true,
      grounded: true,
      madeClaims: true,
    });

    const madeUp = saveReview(
      "rev-a",
      run,
      transcript.taskId,
      {
        labels: {
          ...labels,
          outcome: "partly-correct",
          wentWrong: ["wrong-number"],
          fromTools: "partly",
          unsupportedParts: ["about 660 km"],
        },
      },
      directory
    );
    expect(judgeFields(madeUp.labels)).toEqual({
      answered: false,
      grounded: false,
      madeClaims: true,
    });

    const refusal = saveReview(
      "rev-a",
      run,
      transcript.taskId,
      { labels: { ...labels, outcome: "honestly-cant", fromTools: "no-facts" } },
      directory
    );
    expect(judgeFields(refusal.labels)).toEqual({
      answered: false,
      grounded: true,
      madeClaims: false,
    });
  });
});

describe("matchingReview", () => {
  it("finds the review of this exact answer, and none for a different answer", () => {
    expect(matchingReview({}, run.id, transcript)).toBeUndefined();

    const review = saveReview("rev-a", run, transcript.taskId, { labels }, directory);
    const reviews = readReviews("rev-a", directory);
    expect(matchingReview(reviews, run.id, transcript)).toEqual(review);
    expect(
      matchingReview(reviews, run.id, { ...transcript, answer: "About 700 km." })
    ).toBeUndefined();
  });
});

describe("readRun", () => {
  it("lists and reads a recorded run, and rejects one of the wrong shape", () => {
    const { id, ...file } = run;
    fs.writeFileSync(path.join(directory, `${id}.json`), JSON.stringify(file));
    fs.writeFileSync(
      path.join(directory, "broken.json"),
      JSON.stringify({ ...file, transcripts: [withoutJudge] })
    );

    expect(listRuns(directory)).toEqual(["broken", id]);
    expect(readRun(id, directory)).toEqual(run);
    expect(() => readRun("broken", directory)).toThrow();
    expect(() => readRun("missing", directory)).toThrow(/No recorded run/);
  });

  it("saves a run under its time, model and corpus, and reads it back", () => {
    const { id: _id, ...file } = run;
    const saved = writeRun({ ...file, generatedAt: "2026-11-16T15:30:12.000Z" }, directory);

    expect(path.basename(saved)).toBe("2026-11-16-15-30-gpt-4.1-standard.json");
    expect(readRun("2026-11-16-15-30-gpt-4.1-standard", directory).transcripts).toEqual([
      transcript,
    ]);
  });

  // The recorded runs are git-ignored, so CI has none and skips this.
  it.skipIf(!listRuns().length)("reads every run in the repo", () => {
    for (const id of listRuns()) expect(readRun(id).transcripts.length).toBeGreaterThan(0);
  });
});
