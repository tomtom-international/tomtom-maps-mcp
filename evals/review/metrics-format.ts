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
 * The metrics as Markdown tables, the same wherever they are printed: the golden set's report, the
 * judge's comparison with people, and a capability run's summary.
 */

import type { Agreement } from "./agreement";
import type { Count, Metrics } from "./metrics";
import { REVIEW_FORM } from "./reviews";

export const percent = (count: number, of: number): string =>
  of ? `${Math.round((100 * count) / of)}%` : "–";

const formatCount = ({ count, of }: Count): string => `${count}/${of} (${percent(count, of)})`;

export const formatAgreement = ({ items, agreed, kappa }: Agreement): string =>
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

export const table = (header: readonly string[], rows: readonly (readonly string[])[]): string =>
  [header, header.map(() => "---"), ...rows].map((row) => `| ${row.join(" | ")} |`).join("\n");

const METRIC_ROWS: readonly [string, (metrics: Metrics) => string][] = [
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
      `${metrics.madeUpFacts.length} answer${metrics.madeUpFacts.length === 1 ? "" : "s"}`,
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

/** One row per metric, one column per set of metrics. */
export const metricsTable = (columns: readonly { name: string; metrics: Metrics }[]): string =>
  table(
    ["Metric", ...columns.map(({ name }) => name)],
    METRIC_ROWS.map(([name, format]) => [name, ...columns.map(({ metrics }) => format(metrics))])
  );

/** Each answer's quoted facts that did not come from the tools. */
export const madeUpFactsList = (metrics: Metrics): string =>
  metrics.madeUpFacts
    .map(({ taskId, parts }) => `- **${taskId}**\n${parts.map((part) => `  - ${part}`).join("\n")}`)
    .join("\n") || "None.";
