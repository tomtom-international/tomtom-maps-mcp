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
import { describe, expect, it } from "vitest";
import type { Dispute } from "./agreement";
import {
  type Assignment,
  assign,
  readAssignment,
  tiebreakAssignments,
  writeAssignments,
} from "./assignments";
import { reviewKey } from "./reviews";
import type { RecordedRun, Transcript } from "./runs";

const transcript = (taskId: string, capability: string): Transcript => ({
  taskId,
  capability,
  expected: "pass",
  turns: [`Prompt for ${taskId}`],
  rubric: "Any answer.",
  answer: "An answer.",
  toolCalls: [],
  judge: {
    answered: true,
    grounded: true,
    acknowledgedLimit: false,
    madeClaims: false,
    reason: "",
    judgedOnCompleteData: true,
  },
});

const recorded = (id: string, tasks: number, capabilities: string[]): RecordedRun => ({
  id,
  model: "gpt-4.1",
  provider: "azure",
  judgeModel: "gpt-5.1",
  temperature: 0,
  maxSteps: 8,
  corpus: "golden",
  commit: "6eb9fdd",
  generatedAt: "2026-11-18T13:01:14.326Z",
  transcripts: Array.from({ length: tasks }, (_, index) =>
    transcript(`${id}-task-${index}`, capabilities[index % capabilities.length])
  ),
});

const runs = [
  recorded("standard", 29, ["lookup", "route-analysis", "aggregate-at-scale"]),
  recorded("golden", 20, ["unsupported"]),
];

const keysOf = (assignment: Assignment) =>
  assignment.runs.flatMap((run) =>
    run.transcripts.map((transcript) => reviewKey(run.id, transcript.taskId))
  );

describe("assign", () => {
  const assignments = assign(runs);

  it("gives every task to exactly two reviewers", () => {
    const counts = new Map<string, number>();
    for (const key of assignments.flatMap(keysOf)) counts.set(key, (counts.get(key) ?? 0) + 1);
    expect(counts.size).toBe(49);
    expect(new Set(counts.values())).toEqual(new Set([2]));
  });

  it("has every pair of reviewers share tasks, in blocks that differ by at most one", () => {
    expect(assignments.map((assignment) => assignment.blocks)).toEqual([
      ["A", "B"],
      ["B", "C"],
      ["C", "A"],
    ]);
    const sizes = assignments.map((assignment) => keysOf(assignment).length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    for (const [one, other] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ]) {
      const shared = keysOf(assignments[one]).filter((key) =>
        keysOf(assignments[other]).includes(key)
      );
      expect(shared.length).toBeGreaterThanOrEqual(16);
    }
  });

  it("keeps each run's id and gives every reviewer some of each run", () => {
    for (const assignment of assignments) {
      expect(assignment.runs.map((run) => run.id)).toEqual(["standard", "golden"]);
    }
  });

  it("leaves the judge's verdicts out of every reviewer's file", () => {
    const transcripts = assignments.flatMap((assignment) =>
      assignment.runs.flatMap((run) => run.transcripts)
    );
    expect(transcripts.some((transcript) => "judge" in transcript)).toBe(false);
  });

  it.each([1, 11])("rejects %i reviewers", (reviewers) =>
    expect(() => assign(runs, reviewers)).toThrow(/Reviewers must be/)
  );
});

describe("tiebreakAssignments", () => {
  const [standard] = runs;
  const dispute = (index: number, tiebreakers: string[]): Dispute => ({
    task: { runId: standard.id, transcript: standard.transcripts[index], reviews: [] },
    disputed: ["outcome"],
    tiebreakers,
  });

  it("gives each disputed task to its least loaded tiebreaker, without the judge", () => {
    const assignments = tiebreakAssignments(runs, [
      dispute(0, ["a"]),
      dispute(1, ["a", "b"]),
      dispute(2, ["b"]),
      dispute(3, []),
    ]);
    expect(
      assignments.map(({ reviewer, runs: shared }) => [
        reviewer,
        shared.flatMap((run) => run.transcripts.map((transcript) => transcript.taskId)),
      ])
    ).toEqual([
      ["tiebreak-a", ["standard-task-0"]],
      ["tiebreak-b", ["standard-task-1", "standard-task-2"]],
    ]);
    const transcripts = assignments.flatMap(({ runs: shared }) =>
      shared.flatMap((run) => run.transcripts)
    );
    expect(transcripts.some((transcript) => "judge" in transcript)).toBe(false);
  });
});

describe("writeAssignments and readAssignment", () => {
  it("round-trips each reviewer's file", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eval-assignments-"));
    try {
      const assignments = assign(runs);
      const files = writeAssignments(assignments, directory);
      expect(files.map((file) => path.basename(file))).toEqual([
        "reviewer-1.json",
        "reviewer-2.json",
        "reviewer-3.json",
      ]);
      expect(readAssignment(files[0])).toEqual(assignments[0]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
