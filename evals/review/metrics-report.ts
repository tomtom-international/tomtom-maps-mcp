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
 * `pnpm evals:review:metrics`: prints the answer-quality metrics of the golden set from its final
 * labels, for every task and per run, with judge and reviewer agreement, and writes them with the
 * made-up facts to `evals/golden/metrics.md`, which is git-ignored.
 */

import fs from "node:fs";
import path from "node:path";
import {
  JUDGED_QUESTIONS,
  judgeAgreement,
  type LabeledTask,
  loadLabeledTasks,
  reviewerAgreement,
} from "./agreement";
import { computeMetrics, finalLabels, labeledAnswer, type Metrics } from "./metrics";
import { formatAgreement, madeUpFactsList, metricsTable, table } from "./metrics-format";

const REPORT = path.resolve(import.meta.dirname, "../golden/metrics.md");

const { runs, tasks } = loadLabeledTasks();

const metricsOf = (subset: readonly LabeledTask[]): Metrics =>
  computeMetrics(subset.map((task) => labeledAnswer(task.transcript, finalLabels(task))));

const columns = [
  { name: "All", metrics: metricsOf(tasks) },
  ...runs.map((run) => ({
    name: run.id,
    metrics: metricsOf(tasks.filter((task) => task.runId === run.id)),
  })),
];

const reviewed = reviewerAgreement(tasks).overall;
const judged = judgeAgreement(tasks);
const AGREEMENT_ROWS: readonly [string, string, string][] = [
  [
    "Pass or fail",
    formatAgreement(reviewed.answered),
    formatAgreement(judged.answered.againstSettled),
  ],
  [
    "Made anything up",
    formatAgreement(reviewed.grounded),
    formatAgreement(judged.grounded.againstSettled),
  ],
  [
    "States facts",
    formatAgreement(reviewed.madeClaims),
    formatAgreement(judged.madeClaims.againstSettled),
  ],
];

const agreementTable = table(
  ["Question", "Reviewer agreement", "Judge agreement (vs final labels)"],
  AGREEMENT_ROWS.map((row) => [...row])
);

const summary = `${metricsTable(columns)}\n\n${agreementTable}`;
fs.writeFileSync(
  REPORT,
  `${[
    "# Golden set: metrics",
    `Generated ${new Date().toISOString()} by \`pnpm evals:review:metrics\`, from the final labels ` +
      "(see `evals/review/metrics.ts` for how each tool-call metric counts).",
    `Judge fields compared: ${JUDGED_QUESTIONS.join(", ")}. κ: below 0.40 poor, 0.40–0.60 moderate, ` +
      "0.60–0.80 substantial, above 0.80 almost perfect.",
    summary,
    "## Made-up facts",
    madeUpFactsList(columns[0].metrics),
  ].join("\n\n")}\n`
);
console.log(`${summary}\n\nDetails: ${REPORT}`);
