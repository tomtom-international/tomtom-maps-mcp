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
 * `pnpm evals:review:tiebreak`: writes `evals/golden/assignments/tiebreak-<handle>.json` for each
 * reviewer with disputed tasks to settle, holding only those tasks. The reviewer opens it on the
 * labeling page and labels under their usual handle.
 */

import { disputes, loadLabeledTasks } from "./agreement";
import { tiebreakAssignments, writeAssignments } from "./assignments";

const { runs, reviewers, tasks } = loadLabeledTasks();
const disputed = disputes(tasks, reviewers);
const assignments = tiebreakAssignments(runs, disputed);
const files = writeAssignments(assignments);

for (const [index, assignment] of assignments.entries()) {
  const count = assignment.runs.reduce((total, run) => total + run.transcripts.length, 0);
  console.log(`${files[index]}: ${count} tasks`);
}
const unsettleable = disputed.filter(({ tiebreakers }) => !tiebreakers.length);
if (unsettleable.length) {
  console.log(
    `No reviewer is left to settle: ${unsettleable
      .map(({ task }) => `${task.runId}/${task.transcript.taskId}`)
      .join(", ")}`
  );
}
