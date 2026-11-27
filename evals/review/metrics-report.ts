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
  type Agreement,
  JUDGED_QUESTIONS,
  judgeAgreement,
  type LabeledTask,
  loadLabeledTasks,
  reviewerAgreement,
} from "./agreement";
import { type Count, computeMetrics, finalLabels, type Metrics } from "./metrics";
import { REVIEW_FORM } from "./reviews";

const REPORT = path.resolve(import.meta.dirname, "../golden/metrics.md");

const percent = (count: number, of: number): string =>
  of ? `${Math.round((100 * count) / of)}%` : "–";

const formatCount = ({ count, of }: Count): string => `${count}/${of} (${percent(count, of)})`;

const formatAgreement = ({ items, agreed, kappa }: Agreement): string =>
  `${agreed}/${items} (${percent(agreed, items)}), κ ${kappa === undefined ? "n/a" : kappa.toFixed(2)}`;

/** A tally in the form's order and words, leaving out answers nobody gave. */
const formatTally = (
  tally: Record<string, number>,
  options: readonly { value: string; label: string }[]
): string =>
  options
    .filter(({ value }) => tally[value])
    .map(({ value, label }) => `${label} ${tally[value]}`)
    .join(", ") || "none";

const table = (header: readonly string[], rows: readonly (readonly string[])[]): string =>
  [header, header.map(() => "---"), ...rows].map((row) => `| ${row.join(" | ")} |`).join("\n");

const { runs, tasks } = loadLabeledTasks();

const metricsOf = (subset: readonly LabeledTask[]): Metrics =>
  computeMetrics(
    subset.map((task) => ({ transcript: task.transcript, labels: finalLabels(task) }))
  );

const columns = [
  { name: "All", metrics: metricsOf(tasks) },
  ...runs.map((run) => ({
    name: run.id,
    metrics: metricsOf(tasks.filter((task) => task.runId === run.id)),
  })),
];

const ROWS: readonly [string, (metrics: Metrics) => string][] = [
  ["Tasks", (metrics) => String(metrics.tasks)],
  [
    "Task completion",
    (metrics) =>
      `${formatCount(metrics.taskCompletion)}; partly ${metrics.partlyCorrect}` +
      (metrics.rubricWrong ? `; rubric wrong ${metrics.rubricWrong}` : ""),
  ],
  ["Refusals: correct", (metrics) => String(metrics.correctRefusals)],
  [
    "Refusals: could have answered",
    (metrics) =>
      `${metrics.unwarrantedRefusals}` +
      (metrics.unwarrantedAfterFailedCall
        ? ` (${metrics.unwarrantedAfterFailedCall} after a failed call)`
        : ""),
  ],
  ["Failure types", (metrics) => formatTally(metrics.failureTypes, REVIEW_FORM.wentWrong.options)],
  [
    "Faithfulness",
    (metrics) =>
      `${formatCount(metrics.faithfulness)}; ${metrics.answersWithoutFacts} state no facts`,
  ],
  [
    "Made-up facts",
    (metrics) =>
      `${metrics.madeUpFacts.length} answer${metrics.madeUpFacts.length === 1 ? "" : "s"} (listed below)`,
  ],
  ["Harm (failed answers)", (metrics) => formatTally(metrics.harm, REVIEW_FORM.misled.options)],
  ["Tool correctness", (metrics) => formatCount(metrics.toolCorrectness)],
  ["Argument correctness", (metrics) => formatCount(metrics.argumentCorrectness)],
  ["MCP Use", (metrics) => formatCount(metrics.mcpUse)],
  ["Missed calls", (metrics) => formatCount(metrics.missedCalls)],
  [
    "Step efficiency: unneeded calls",
    (metrics) => `${formatCount(metrics.unneededCalls)}, of which repeats ${metrics.repeatedCalls}`,
  ],
  [
    "Error handling",
    (metrics) => formatTally(metrics.errorHandling, REVIEW_FORM.toolFailure.options),
  ],
  [
    "Unsettled",
    ({ unsettled }) =>
      `pass/fail ${unsettled.answered}, made up ${unsettled.grounded}, outcome ${unsettled.outcome}, ` +
      `misled ${unsettled.misled}, calls ${unsettled.toolCalls}`,
  ],
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

const metricsTable = table(
  ["Metric", ...columns.map(({ name }) => name)],
  ROWS.map(([name, format]) => [name, ...columns.map(({ metrics }) => format(metrics))])
);
const agreementTable = table(
  ["Question", "Reviewer agreement", "Judge agreement (vs final labels)"],
  AGREEMENT_ROWS.map((row) => [...row])
);
const madeUp = columns[0].metrics.madeUpFacts
  .map(({ taskId, parts }) => `- **${taskId}**\n${parts.map((part) => `  - ${part}`).join("\n")}`)
  .join("\n");

const summary = `${metricsTable}\n\n${agreementTable}`;
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
    madeUp || "None.",
  ].join("\n\n")}\n`
);
console.log(`${summary}\n\nDetails: ${REPORT}`);
