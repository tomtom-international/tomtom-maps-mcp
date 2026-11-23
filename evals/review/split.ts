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
 * `pnpm evals:review:split [reviewers]`: shares the runs in `evals/golden/runs/` out among
 * reviewers (default 3), one file each in `evals/golden/assignments/`.
 */

import { assign, writeAssignments } from "./assignments";
import { listRuns, readRun } from "./runs";

const reviewers = Number(process.argv[2] ?? 3);
// Oldest run first, so adding a newer run leaves the earlier tasks in their blocks.
const runs = listRuns()
  .reverse()
  .map((id) => readRun(id));
const assignments = assign(runs, reviewers);
const files = writeAssignments(assignments);

for (const [index, assignment] of assignments.entries()) {
  const tasks = assignment.runs.reduce((total, run) => total + run.transcripts.length, 0);
  console.log(`${files[index]}: blocks ${assignment.blocks.join(" + ")}, ${tasks} tasks`);
}
