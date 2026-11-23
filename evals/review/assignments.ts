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
 * Shares the recorded runs out among reviewers, one file each, so every task is labeled by two
 * of them. The tasks are dealt into as many blocks as there are reviewers, each run's tasks in
 * order of capability so every block gets a mix, and reviewer i labels blocks i and i + 1. Each
 * pair of neighbouring reviewers then shares a block, for measuring how well they agree. Runs
 * keep their ids, so labels from different reviewers match by `reviewKey`. The judge's verdicts
 * are left out: reviewers label without them, and they are compared with the labels offline.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { reviewKey } from "./reviews";
import { type RecordedRun, reviewableRunSchema } from "./runs";

/** Where `pnpm evals:review:split` writes the reviewers' files. */
export const ASSIGNMENTS_DIRECTORY = path.resolve(import.meta.dirname, "../golden/assignments");

const assignmentSchema = z.object({
  /** The file's name, not a handle: the reviewer still gives theirs when labeling. */
  reviewer: z.string(),
  blocks: z.array(z.string()),
  runs: z.array(reviewableRunSchema),
});

export type Assignment = z.infer<typeof assignmentSchema>;

const BLOCK_NAMES = "ABCDEFGHIJ";

/** Splits `runs` among `reviewers` (2 to 10), every task going to exactly two of them. */
export function assign(runs: readonly RecordedRun[], reviewers = 3): Assignment[] {
  if (reviewers < 2 || reviewers > BLOCK_NAMES.length) {
    throw new Error(`Reviewers must be 2 to ${BLOCK_NAMES.length}, not ${reviewers}.`);
  }
  const blockOf = new Map<string, number>();
  let dealt = 0;
  for (const run of runs) {
    const ordered = [...run.transcripts].sort(
      (one, other) =>
        one.capability.localeCompare(other.capability) || one.taskId.localeCompare(other.taskId)
    );
    for (const transcript of ordered) {
      blockOf.set(reviewKey(run.id, transcript.taskId), dealt % reviewers);
      dealt += 1;
    }
  }

  return Array.from({ length: reviewers }, (_, reviewer) => {
    const blocks = [reviewer, (reviewer + 1) % reviewers];
    const isLabelled = (run: RecordedRun, taskId: string) =>
      blocks.includes(blockOf.get(reviewKey(run.id, taskId)) ?? -1);
    return {
      reviewer: `reviewer-${reviewer + 1}`,
      blocks: blocks.map((block) => BLOCK_NAMES[block]),
      runs: runs
        .map((run) => ({
          ...run,
          transcripts: run.transcripts
            .filter((transcript) => isLabelled(run, transcript.taskId))
            .map(({ judge: _, ...transcript }) => transcript),
        }))
        .filter((run) => run.transcripts.length),
    };
  });
}

/** Writes each assignment to `<directory>/<reviewer>.json` and returns the paths. */
export function writeAssignments(
  assignments: readonly Assignment[],
  directory = ASSIGNMENTS_DIRECTORY
): string[] {
  fs.mkdirSync(directory, { recursive: true });
  return assignments.map((assignment) => {
    const file = path.join(directory, `${assignment.reviewer}.json`);
    fs.writeFileSync(file, `${JSON.stringify(assignmentSchema.parse(assignment), null, 2)}\n`);
    return file;
  });
}

/** Reads and validates one reviewer's file. */
export function readAssignment(file: string): Assignment {
  return assignmentSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}
