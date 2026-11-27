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
 * `pnpm evals:review:rejudge`: has the judge fill in the review form again about
 * every labeled task, from its saved transcript, with the model `harness/model.ts` configures and
 * the form as it is now. Compares its answers with the final labels question by question, per side
 * of the split, and its pass and made-up verdicts against the judge recorded with each run and any
 * earlier judgements.
 *
 *   --repeats <n>       judge each task n times, to measure consistency (default 5)
 *   --split <side>      tuning, held-back or all (default all)
 *   --label <name>      save as golden/judgements/<name>.json (default <model>-<prompt version>)
 *   --compare <label>   also show earlier judgements, by label; repeatable
 *   --report-only       judge nothing: report on the judgements --label names
 *
 * Writes `golden/judgements/<label>.md` with the tuning tasks the judge got wrong and its reasons.
 * Held-back tasks are left out of it on purpose: reading them is tuning on them.
 */

import "../harness/load-env";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { outageIn } from "../capability/judge";
import { JUDGE_MODEL, JUDGE_MODEL_ID, JUDGE_PROVIDER } from "../harness/model";
import {
  JUDGED_QUESTIONS,
  type JudgedVerdict,
  judgeAgreement,
  type LabeledTask,
  loadLabeledTasks,
  reviewerAgreement,
  settledLabels,
} from "./agreement";
import { FORM_JUDGE_VERSION, judgeForm, verdictOf } from "./form-judge";
import {
  consistency,
  JUDGEMENTS_DIRECTORY,
  type Judgements,
  majorityVerdict,
  readJudgements,
  type SavedVerdict,
  type Split,
  splitOf,
  writeJudgements,
} from "./judgements";
import {
  type ComparedLabel,
  comparedLabelsOf,
  compareFinalLabels,
  computeMetrics,
  type FinalLabels,
  finalLabels,
  labelConsistency,
  labeledAnswer,
  settleLabels,
} from "./metrics";
import { formatShortAgreement, metricsTable, percent, table } from "./metrics-format";
import { questionsAnswered, reviewKey } from "./reviews";

/** Judge calls in flight at once; more trips Azure's rate limits. */
const CONCURRENCY = 2;

const { values } = parseArgs({
  options: {
    repeats: { type: "string", default: "5" },
    split: { type: "string", default: "all" },
    label: { type: "string" },
    compare: { type: "string", multiple: true, default: [] },
    "report-only": { type: "boolean", default: false },
  },
});

const repeats = Number(values.repeats);
if (!Number.isInteger(repeats) || repeats < 1)
  throw new Error(`--repeats must be a whole number, not ${values.repeats}.`);
if (!["all", "tuning", "held-back"].includes(values.split)) {
  throw new Error(`--split must be all, tuning or held-back, not ${values.split}.`);
}

/** The instructions the verdicts are given under. */
const promptVersion = `form-${FORM_JUDGE_VERSION}`;

const keyOf = (task: LabeledTask): string => reviewKey(task.runId, task.transcript.taskId);
const { runs, tasks: labeled } = loadLabeledTasks();
// A capability run does not judge an answer a TomTom outage cut short, so no judge is scored on one.
const tasks = labeled.filter((task) => !outageIn(task.transcript.toolCalls));
const outages = labeled.length - tasks.length;
const contextOf = new Map(runs.map((run) => [run.id, run.context]));
const chosen = tasks.filter(
  (task) => values.split === "all" || splitOf(keyOf(task)) === values.split
);

/** Runs `work` over `items`, at most {@link CONCURRENCY} at once. */
async function inPool<Item>(
  items: readonly Item[],
  work: (item: Item) => Promise<void>
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await work(items[next++]);
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

async function judgeAll(label: string): Promise<Judgements> {
  if (!JUDGE_PROVIDER || !JUDGE_MODEL_ID || !JUDGE_MODEL) {
    throw new Error(
      "No judge configured: set EVAL_JUDGE_PROVIDER and EVAL_JUDGE_MODEL_ID, or a provider key."
    );
  }
  const model = JUDGE_MODEL;
  /** One form filled in about `task`. */
  const judgeOnce = async ({ runId, transcript }: LabeledTask): Promise<SavedVerdict> => {
    const { labels, reason, judgeTokens } = await judgeForm(model, {
      task: {
        id: transcript.taskId,
        capability: transcript.capability,
        expected: transcript.expected,
      },
      turns: transcript.turns,
      rubric: transcript.rubric,
      reference: transcript.reference,
      toolViews: transcript.toolCalls,
      answer: transcript.answer,
      context: contextOf.get(runId),
    });
    return { ...verdictOf(labels), reason, judgeTokens, labels };
  };
  const verdicts: Record<string, SavedVerdict[]> = {};
  const errors: Record<string, string[]> = {};
  const jobs = chosen.flatMap((task) => Array.from({ length: repeats }, () => task));
  let done = 0;
  await inPool(jobs, async (task) => {
    const key = keyOf(task);
    try {
      // Awaited first: reading `verdicts[key]` before the await loses the repeats that land meanwhile.
      const verdict = await judgeOnce(task);
      verdicts[key] = [...(verdicts[key] ?? []), verdict];
    } catch (error) {
      errors[key] = [
        ...(errors[key] ?? []),
        error instanceof Error ? error.message : String(error),
      ];
    }
    done += 1;
    if (done % 10 === 0 || done === jobs.length) console.error(`judged ${done}/${jobs.length}`);
  });
  const kept = Object.values(verdicts).flat().length + Object.values(errors).flat().length;
  if (kept !== jobs.length) throw new Error(`Kept ${kept} of ${jobs.length} judgements.`);
  return {
    label,
    judgeProvider: JUDGE_PROVIDER,
    judgeModel: JUDGE_MODEL_ID,
    promptVersion,
    repeats,
    generatedAt: new Date().toISOString(),
    verdicts,
    errors,
  };
}

const label =
  values.label ?? `${(JUDGE_MODEL_ID ?? "judge").replace(/[^a-z0-9.-]+/gi, "-")}-${promptVersion}`;
const judgements = values["report-only"] ? readJudgements(label) : await judgeAll(label);
if (!values["report-only"]) console.error(`Saved ${writeJudgements(judgements)}`);

const judges: {
  name: string;
  verdictOf: (task: LabeledTask) => JudgedVerdict | undefined;
  tokens?: number;
}[] = [
  { name: "recorded with the run", verdictOf: (task) => task.transcript.judge },
  ...[...values.compare, label].map((name) => {
    const saved = name === label ? judgements : readJudgements(name);
    return {
      name: `${saved.label} (${saved.judgeModel}, ×${saved.repeats})`,
      verdictOf: (task: LabeledTask) => majorityVerdict(saved.verdicts[keyOf(task)] ?? []),
      tokens: Object.values(saved.verdicts)
        .flat()
        .reduce((sum, verdict) => sum + verdict.judgeTokens, 0),
    };
  }),
];

const SIDES: readonly (Split | "all")[] = ["tuning", "held-back", "all"];
const tasksOn = (side: Split | "all") =>
  tasks.filter((task) => side === "all" || splitOf(keyOf(task)) === side);

const agreementTable = table(
  ["Judge", ...SIDES.flatMap((side) => JUDGED_QUESTIONS.map((question) => `${side}: ${question}`))],
  judges.map(({ name, verdictOf }) => [
    name,
    ...SIDES.flatMap((side) => {
      const compared = judgeAgreement(tasksOn(side), verdictOf);
      return JUDGED_QUESTIONS.map((question) =>
        formatShortAgreement(compared[question].againstSettled)
      );
    }),
  ])
);
const consistent = consistency(judgements.verdicts);
const consistencyLine =
  `Consistency of ${judgements.label} over ${judgements.repeats} repeats: ` +
  JUDGED_QUESTIONS.map(
    (question) =>
      `${question} ${consistent[question].count}/${consistent[question].of} (${percent(consistent[question].count, consistent[question].of)})`
  ).join(", ") +
  `. Errors: ${Object.values(judgements.errors).flat().length}. Judge tokens: ` +
  judges
    .flatMap(({ name, tokens }) => (tokens === undefined ? [] : [`${name} ${tokens}`]))
    .join(", ");

const wrongOnTuning = tasksOn("tuning").flatMap((task) => {
  const verdicts = judgements.verdicts[keyOf(task)] ?? [];
  const verdict = majorityVerdict(verdicts);
  const settled = settledLabels(task);
  const differing = JUDGED_QUESTIONS.filter(
    (question) =>
      verdict && settled[question] !== undefined && settled[question] !== String(verdict[question])
  );
  if (!differing.length) return [];
  return [
    [
      `### ${keyOf(task)}: ${differing.map((question) => `${question} judged ${verdict?.[question]}, labeled ${settled[question]}`).join("; ")}`,
      `**Prompt:** ${task.transcript.turns.at(-1)}`,
      `**Rubric:** ${task.transcript.rubric}`,
      `**Answer:**\n\n${task.transcript.answer
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}`,
      `**Judge's reasons:**\n\n${verdicts.map((each) => `- ${each.reason}`).join("\n")}`,
    ].join("\n\n"),
  ];
});

/** Plain names for the compared questions, as the metrics report words them. */
const QUESTION_NAMES: Record<ComparedLabel, string> = {
  answered: "Pass or fail",
  grounded: "Made anything up",
  madeClaims: "States facts",
  outcome: "Outcome",
  missingCall: "Missed a call",
  misled: "Would mislead",
  toolCalls: "Each tool call",
};

/** Each task the saved judge filled in forms about, with them, on one side of the split. */
const formsOn = (side: Split | "all") =>
  tasksOn(side).flatMap((task) => {
    const forms = (judgements.verdicts[keyOf(task)] ?? []).flatMap((verdict) =>
      verdict.labels ? [verdict.labels] : []
    );
    if (!forms.length) return [];
    const judged = settleLabels(task.transcript, forms, forms.length > 1 ? "majority" : "whole");
    return [{ task, forms, judged }];
  });

/** Per side, the form judge against people question by question, and the metrics from each. */
const formSections = SIDES.flatMap((side) => {
  const judged = formsOn(side);
  // "all" repeats a side when only that side was judged.
  if (!judged.length || (side === "all" && judged.length !== tasksOn("all").length)) return [];
  const reviewers = reviewerAgreement(judged.map(({ task }) => task)).overall;
  const againstPeople = compareFinalLabels(
    judged.map(({ task, judged: labels }) => ({ expected: finalLabels(task), actual: labels }))
  );
  const steady = labelConsistency(
    judged.map(({ task, forms }) => ({ transcript: task.transcript, forms }))
  );
  const asked = questionsAnswered(judged.flatMap(({ forms }) => forms));
  const metricsOf = (labelsOf: (entry: (typeof judged)[number]) => FinalLabels) =>
    computeMetrics(judged.map((entry) => labeledAnswer(entry.task.transcript, labelsOf(entry))));
  return [
    `## The form, ${side} (${judged.length} tasks)`,
    table(
      ["Question", "Reviewers vs each other", "Judge vs final labels", "Judge same in all repeats"],
      comparedLabelsOf(asked).map((question) => [
        QUESTION_NAMES[question],
        formatShortAgreement(reviewers[question]),
        formatShortAgreement(againstPeople[question]),
        `${steady[question].count}/${steady[question].of} (${percent(steady[question].count, steady[question].of)})`,
      ])
    ),
    metricsTable([
      { name: "From people's labels", metrics: metricsOf(({ task }) => finalLabels(task)) },
      {
        name: "From the judge's forms",
        metrics: metricsOf(({ judged: labels }) => labels),
        asked,
      },
    ]),
  ];
});

const summary = [agreementTable, consistencyLine, ...formSections].join("\n\n");
const reportFile = path.join(JUDGEMENTS_DIRECTORY, `${judgements.label}.md`);
fs.writeFileSync(
  reportFile,
  `${[
    `# Judge ${judgements.label}`,
    `${judgements.judgeProvider}/${judgements.judgeModel}, prompt ${judgements.promptVersion}, ${judgements.generatedAt}. ` +
      "Agreement is the majority over repeats against the final labels." +
      (outages ? ` ${outages} labeled answer(s) cut short by a TomTom outage are left out.` : ""),
    summary,
    `## Tuning tasks the judge got wrong (${wrongOnTuning.length})`,
    ...wrongOnTuning,
  ].join("\n\n")}\n`
);
console.log(`${summary}\n\nDetails: ${reportFile}`);
