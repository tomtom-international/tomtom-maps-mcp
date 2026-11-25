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
import { type FormQuestion, REVIEW_FORM } from "./reviews";

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

/** Each metric: its name, the questions of the form it is worked out from, and its cell. */
const METRIC_ROWS: readonly [
  string,
  readonly FormQuestion[],
  (metrics: Metrics, asks: (question: FormQuestion) => boolean) => string,
][] = [
  ["Tasks", [], (metrics) => String(metrics.tasks)],
  [
    "Task completion",
    ["outcome"],
    (metrics) =>
      `${formatCount(metrics.taskCompletion)}; partly ${metrics.partlyCorrect}` +
      (metrics.rubricWrong ? `; rubric wrong ${metrics.rubricWrong}` : ""),
  ],
  ["Refusals: correct", ["outcome"], (metrics) => String(metrics.correctRefusals)],
  [
    "Refusals: could have answered",
    ["outcome"],
    (metrics) =>
      `${metrics.unwarrantedRefusals}` +
      (metrics.unwarrantedAfterFailedCall
        ? ` (${metrics.unwarrantedAfterFailedCall} after a failed call)`
        : ""),
  ],
  [
    "Failure types",
    ["wentWrong"],
    (metrics) => formatTally(metrics.failureTypes, REVIEW_FORM.wentWrong.options),
  ],
  [
    "Faithfulness",
    ["fromTools"],
    (metrics) =>
      `${formatCount(metrics.faithfulness)}; ${metrics.answersWithoutFacts} state no facts`,
  ],
  [
    "Made-up facts",
    ["fromTools"],
    (metrics) =>
      `${metrics.madeUpFacts.length} answer${metrics.madeUpFacts.length === 1 ? "" : "s"}`,
  ],
  [
    "Harm (failed answers)",
    ["misled"],
    (metrics) => formatTally(metrics.harm, REVIEW_FORM.misled.options),
  ],
  ["Tool correctness", ["toolCalls"], (metrics) => formatCount(metrics.toolCorrectness)],
  ["Argument correctness", ["toolCalls"], (metrics) => formatCount(metrics.argumentCorrectness)],
  ["MCP Use", ["toolCalls"], (metrics) => formatCount(metrics.mcpUse)],
  ["Missed calls", ["missingCall"], (metrics) => formatCount(metrics.missedCalls)],
  [
    "Step efficiency: unneeded calls",
    ["toolCalls"],
    (metrics) => `${formatCount(metrics.unneededCalls)}, of which repeats ${metrics.repeatedCalls}`,
  ],
  [
    "Error handling",
    ["toolFailure"],
    (metrics) => formatTally(metrics.errorHandling, REVIEW_FORM.toolFailure.options),
  ],
  [
    "Unsettled",
    [],
    ({ unsettled }, asks) =>
      (
        [
          ["pass/fail", "outcome", unsettled.answered],
          ["made up", "fromTools", unsettled.grounded],
          ["outcome", "outcome", unsettled.outcome],
          ["misled", "misled", unsettled.misled],
          ["calls", "toolCalls", unsettled.toolCalls],
        ] as const
      )
        .filter(([, question]) => asks(question))
        .map(([name, , count]) => `${name} ${count}`)
        .join(", "),
  ],
];

/**
 * One row per metric, one column per set of metrics. A column whose forms were asked only some
 * questions, as the judge's are, says "not asked" for the metrics of the others.
 */
export const metricsTable = (
  columns: readonly { name: string; metrics: Metrics; asked?: readonly FormQuestion[] }[]
): string =>
  table(
    ["Metric", ...columns.map(({ name }) => name)],
    METRIC_ROWS.map(([name, from, format]) => [
      name,
      ...columns.map(({ metrics, asked }) => {
        const asks = (question: FormQuestion) => !asked || asked.includes(question);
        return from.every(asks) ? format(metrics, asks) : "not asked";
      }),
    ])
  );

/** Each answer's quoted facts that did not come from the tools. */
export const madeUpFactsList = (metrics: Metrics): string =>
  metrics.madeUpFacts
    .map(({ taskId, parts }) => `- **${taskId}**\n${parts.map((part) => `  - ${part}`).join("\n")}`)
    .join("\n") || "None.";
