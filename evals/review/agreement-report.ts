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
 * `pnpm evals:review:agreement`: prints how far reviewers agree with each other and with the
 * judge, and writes `evals/golden/agreement.md` with every dispute and every task where the judge
 * and the settled labels differ. The file quotes labels and answers, so it is git-ignored.
 */

import fs from "node:fs";
import path from "node:path";
import {
  type Dispute,
  disputes,
  JUDGED_QUESTIONS,
  judgeAgreement,
  type LabeledTask,
  loadLabeledTasks,
  MEASURES,
  reviewerAgreement,
  settledLabels,
} from "./agreement";
import { formatShortAgreement, table } from "./metrics-format";

const REPORT = path.resolve(import.meta.dirname, "../golden/agreement.md");

/** How much of a tool call's output the report quotes; route outputs run to tens of kilobytes. */
const OUTPUT_CHARACTERS = 3000;

/** The kinds of dispute, most consequential first; a dispute falls under the first that fits. */
const DISPUTE_KINDS: readonly { heading: string; fits: (dispute: Dispute) => boolean }[] = [
  {
    heading: "Pass or fail: changes the score",
    fits: ({ disputed }) => disputed.includes("answered"),
  },
  {
    heading: "Both fail, for different reasons",
    fits: ({ disputed }) => disputed.includes("outcome"),
  },
  { heading: "Wording and tool calls only", fits: () => true },
];

const quote = (text: string): string =>
  text
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

const taskId = (task: LabeledTask): string => `${task.runId}/${task.transcript.taskId}`;

/** Every reviewer's labels on a task, with their comment. */
function reviewLines(task: LabeledTask): string {
  return task.reviews
    .map(({ reviewer, review }) => {
      const { labels, comment } = review;
      const parts = [
        `outcome ${labels.outcome}`,
        `fromTools ${labels.fromTools}`,
        `toolCalls [${labels.toolCalls.join(", ")}]`,
        `missingCall ${labels.missingCall}${labels.missingTool ? ` (${labels.missingTool})` : ""}`,
        `misled ${labels.misled}`,
        labels.wentWrong.length ? `wentWrong ${labels.wentWrong.join(", ")}` : "",
        labels.expectedAnswerFix ? `rubric fix: ${labels.expectedAnswerFix}` : "",
      ].filter(Boolean);
      return `- **${reviewer}**: ${parts.join("; ")}${comment ? `\n  - comment: ${comment}` : ""}`;
    })
    .join("\n");
}

function taskSection(task: LabeledTask, heading: string): string {
  const { transcript } = task;
  return [
    `### ${heading}`,
    `**Prompt:** ${transcript.turns.at(-1)}`,
    `**Rubric:** ${transcript.rubric}`,
    transcript.toolCalls.length
      ? "**Tool calls** (open each for its input and output):"
      : "**Tool calls:** none",
    ...transcript.toolCalls.map(
      (call, index) =>
        `<details><summary>${index}. ${call.name} (${call.status})</summary>\n\n` +
        `Input:\n\n\`\`\`json\n${call.input}\n\`\`\`\n\nOutput` +
        `${call.output.length > OUTPUT_CHARACTERS ? `, first ${OUTPUT_CHARACTERS} of ${call.output.length} characters` : ""}:` +
        `\n\n\`\`\`json\n${call.output.slice(0, OUTPUT_CHARACTERS)}\n\`\`\`\n\n</details>`
    ),
    "**Answer:**",
    quote(transcript.answer),
    `**Judge:** answered ${transcript.judge.answered}, grounded ${transcript.judge.grounded}, ` +
      `madeClaims ${transcript.judge.madeClaims}: ${transcript.judge.reason}`,
    reviewLines(task),
  ].join("\n\n");
}

function disputeSection({ task, disputed, tiebreakers }: Dispute): string {
  const what = disputed.length ? `split on ${disputed.join(", ")}` : "one review only";
  return taskSection(
    task,
    `${taskId(task)}: ${what}; tiebreak by ${tiebreakers.join(" or ") || "nobody left"}`
  );
}

/** Pairs of differing outcomes between a task's first two reviewers, most frequent first. */
function outcomeConfusions(tasks: readonly LabeledTask[]): string[][] {
  const counts = new Map<string, number>();
  for (const { reviews } of tasks) {
    if (reviews.length < 2) continue;
    const pair = [reviews[0].review.labels.outcome, reviews[1].review.labels.outcome].sort();
    if (pair[0] === pair[1]) continue;
    counts.set(pair.join(" vs "), (counts.get(pair.join(" vs ")) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([, one], [, other]) => other - one)
    .map(([pair, count]) => [pair, String(count)]);
}

/** The judged questions whose settled answer the judge contradicts. */
function judgeDifferences(task: LabeledTask): string[] {
  const settled = settledLabels(task);
  return JUDGED_QUESTIONS.filter(
    (question) =>
      settled[question] !== undefined &&
      settled[question] !== String(task.transcript.judge[question])
  );
}

const { reviewers, tasks } = loadLabeledTasks();
const reviewed = reviewerAgreement(tasks);
const judged = judgeAgreement(tasks);
const disputed = disputes(tasks, reviewers);
const disputesOfKind = (heading: string): Dispute[] =>
  disputed.filter(
    (dispute) => DISPUTE_KINDS.find(({ fits }) => fits(dispute))?.heading === heading
  );
const judgeMismatches = tasks.filter((task) => judgeDifferences(task).length);
const rubricFixes = tasks.filter((task) =>
  task.reviews.some(({ review }) => review.labels.outcome === "expected-answer-wrong")
);

const reviewerTable = table(
  [
    "Measure",
    ...reviewed.pairs.map(({ reviewers: pair, tasks: count }) => `${pair.join(" + ")} (${count})`),
    "All",
  ],
  MEASURES.map((measure) => [
    measure,
    ...reviewed.pairs.map(({ measures }) => formatShortAgreement(measures[measure])),
    formatShortAgreement(reviewed.overall[measure]),
  ])
);
const judgeTable = table(
  [
    "Question",
    "Reviewers (each other)",
    "Judge vs each review",
    "Judge vs settled",
    "Judge true, settled false",
    "Judge false, settled true",
    "Unsettled",
  ],
  JUDGED_QUESTIONS.map((question) => [
    question,
    formatShortAgreement(reviewed.overall[question]),
    formatShortAgreement(judged[question].againstReviews),
    formatShortAgreement(judged[question].againstSettled),
    String(judged[question].judgeTrueSettledFalse),
    String(judged[question].judgeFalseSettledTrue),
    String(judged[question].unsettled),
  ])
);
const summary = [
  `${tasks.length} tasks labeled by ${reviewers.join(", ")}; ` +
    `${tasks.filter((task) => task.reviews.length >= 2).length} by two or more.`,
  "",
  "Reviewer agreement, first two reviews of each task (agreed/items, Fleiss' κ):",
  "",
  reviewerTable,
  "",
  "Judge agreement:",
  "",
  judgeTable,
  "",
  `${disputed.length} tasks need a tiebreak; ${judgeMismatches.length} differ from the judge ` +
    `on a settled answer; ${rubricFixes.length} have a rubric fix.`,
].join("\n");

const report = [
  "# Golden set: agreement",
  `Generated ${new Date().toISOString()} by \`pnpm evals:review:agreement\`.`,
  "κ reads as: below 0.40 poor, 0.40–0.60 moderate, 0.60–0.80 substantial, above 0.80 almost perfect.",
  summary,
  "## Outcomes reviewers confused",
  table(["Outcomes", "Tasks"], outcomeConfusions(tasks)),
  "## Tasks to tiebreak",
  "`pnpm evals:review:tiebreak` writes each tiebreaker a file of their tasks; they label them under " +
    "their own handle, applying the rules in `evals/review/labeling-decisions.md`.",
  table(
    ["Kind", "Tasks"],
    DISPUTE_KINDS.map(({ heading }) => [heading, String(disputesOfKind(heading).length)])
  ),
  ...DISPUTE_KINDS.flatMap(({ heading }) => [
    `## ${heading} (${disputesOfKind(heading).length})`,
    ...disputesOfKind(heading).map(disputeSection),
  ]),
  "## The judge against settled labels",
  ...judgeMismatches.map((task) =>
    taskSection(task, `${taskId(task)}: judge differs on ${judgeDifferences(task).join(", ")}`)
  ),
  "## Rubric fixes",
  ...rubricFixes.map((task) => taskSection(task, taskId(task))),
].join("\n\n");

fs.writeFileSync(REPORT, `${report}\n`);
console.log(`${summary}\n\nDetails: ${REPORT}`);
