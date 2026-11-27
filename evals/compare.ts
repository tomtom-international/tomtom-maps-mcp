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
 * The report of a sweep, for any number of targets:
 *
 *   pnpm evals:report [<sweep directory>] [--labels a,b,c]
 *
 * Reads every run in a sweep directory (the newest under `evals/capability/runs/` by
 * default) and writes `comparison.md` and `results.json` beside them: capability medians
 * with their ranges, each target against the first and the one before it, how often each
 * task was answered, and tool selection. Every capability column names the judge that
 * graded it and flags a model that judged itself.
 *
 * A sweep whose runs were not held to the same conditions is still written, under a
 * warning, and then refused with a non-zero exit: a gpt-4.1 baseline against a gpt-5.1
 * current reads exactly like a successful refactor. `EVAL_ALLOW_MISMATCH=1` overrides it.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { CapabilityReport } from "./capability/judge";
import {
  formatNumber,
  type NumericStats,
  numericStats,
  readReports,
  SWEEPS_DIR,
  signed,
  splitList,
} from "./harness/reports";
import {
  firstAttempts,
  readScenarioLog,
  type ScenarioRecord,
  scenarioKey,
  summarizeScenarios,
} from "./harness/scenario-log";
import { REPO_ROOT } from "./harness/target";
import { metricsOfResults } from "./review/metrics";
import { metricsTable } from "./review/metrics-format";
import { questionsAnswered } from "./review/reviews";
import type { SweepManifest } from "./sweep";

type ComparedConditions = Pick<CapabilityReport, "model" | "judgeModel" | "mode"> &
  Partial<Pick<CapabilityReport, "corpus" | "taskFilter" | "budget" | "settings">>;

const SETTINGS = [
  "provider",
  "judgeProvider",
  "temperature",
  "maxSteps",
  "serverInstructions",
] as const satisfies readonly (keyof NonNullable<CapabilityReport["settings"]>)[];

/** How two reports' settings differ; nothing when neither records any. */
function settingsMismatches(
  reference: CapabilityReport["settings"],
  other: CapabilityReport["settings"]
): string[] {
  if (!reference && !other) return [];
  if (!reference || !other) {
    return [
      "one report does not record its settings (providers, temperature, step limit, " +
        "server instructions), so they cannot be shown to match — re-record it",
    ];
  }
  return SETTINGS.filter((setting) => reference[setting] !== other[setting]).map(
    (setting) => `different ${setting}: \`${reference[setting]}\` against \`${other[setting]}\``
  );
}

/**
 * What has to have been held constant for `other` to be compared with `reference`, plus
 * whether `other` ran to the end of its tasks. The suites hold the tasks and the judge's
 * prompt constant; the model, judge, wiring, corpus and settings come from the
 * environment, which can change between two commands typed minutes apart.
 */
export const conditionMismatches = (
  reference: ComparedConditions,
  other: ComparedConditions
): string[] => {
  const problems: string[] = [];

  // A report that does not name a model cannot be verified either way.
  if (!reference.model || !other.model) {
    problems.push(
      "one report does not name the model it used, so the two cannot be shown to " +
        "have run against the same one — re-record it"
    );
  } else if (reference.model !== other.model) {
    problems.push(`different models: \`${reference.model}\` against \`${other.model}\``);
  }

  if (!reference.judgeModel || !other.judgeModel) {
    problems.push(
      "one report does not name its judge model, so the two cannot be shown to have " +
        "been graded by the same one — re-record it"
    );
  } else if (reference.judgeModel !== other.judgeModel) {
    problems.push(`different judges: \`${reference.judgeModel}\` against \`${other.judgeModel}\``);
  }

  // `live` is in-process, `stdio` over the wire: the scores should match, which is a
  // hypothesis, not a licence to mix them in one comparison.
  if (reference.mode !== other.mode) {
    problems.push(`different tool wiring: \`${reference.mode}\` against \`${other.mode}\``);
  }

  // Reports from before `corpus` existed ran the standard one.
  const [referenceCorpus, otherCorpus] = [reference.corpus, other.corpus].map(
    (corpus) => corpus ?? "standard"
  );
  if (referenceCorpus !== otherCorpus) {
    problems.push(`different corpora: \`${referenceCorpus}\` against \`${otherCorpus}\``);
  }

  const taskSet = (report: ComparedConditions) => [...(report.taskFilter ?? [])].sort().join(",");
  const describeTasks = (report: ComparedConditions) =>
    report.taskFilter
      ? `${report.taskFilter.length} task(s) chosen by EVAL_TASK_IDS`
      : "the whole corpus";
  if (taskSet(reference) !== taskSet(other)) {
    problems.push(`different tasks: ${describeTasks(reference)} against ${describeTasks(other)}`);
  }

  problems.push(...settingsMismatches(reference.settings, other.settings));

  if (other.budget?.unrun.length) {
    problems.push(
      `it spent its EVAL_MAX_TOKENS budget of ${other.budget.maxTokens} tokens and left ` +
        `${other.budget.unrun.length} task(s) unrun`
    );
  }

  return problems;
};

/** The same question for the scenario logs, which carry a model id per record. */
export const scenarioModelMismatch = (
  reference: readonly ScenarioRecord[],
  other: readonly ScenarioRecord[]
): string | undefined => {
  // Empty ids are the `unrepresentable` rows, which never ran a model.
  const modelsIn = (records: readonly ScenarioRecord[]) =>
    [...new Set(records.map((record) => record.modelId).filter(Boolean))].sort();
  const [before, after] = [modelsIn(reference), modelsIn(other)];
  if (before.join(",") === after.join(",")) return undefined;
  return `different models: [${before.join(", ") || "none"}] against [${after.join(", ") || "none"}]`;
};

/** A sweep's target as read back: its capability runs and its scenario log. */
export interface LoadedTarget {
  label: string;
  reports: CapabilityReport[];
  scenarios: ScenarioRecord[];
  reusedFrom?: string;
}

const manifestIn = (dir: string): SweepManifest | undefined => {
  const file = path.join(dir, "sweep.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf-8")) : undefined;
};

/** The labels a sweep holds: the manifest's order, else the files' in natural order. */
export function sweepLabels(dir: string): string[] {
  const manifest = manifestIn(dir);
  if (manifest) return manifest.targets.map(({ label }) => label);
  const labels = fs
    .readdirSync(dir)
    .map(
      (name) =>
        name.match(/^report\.(.+)\.\d+\.json$/)?.[1] ?? name.match(/^runs\.(.+)\.jsonl$/)?.[1]
    )
    .filter((label) => label !== undefined);
  return [...new Set(labels)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Reads a sweep's targets, `labels` picking and ordering them. */
export function loadSweep(dir: string, labels = sweepLabels(dir)): LoadedTarget[] {
  const reused = new Map(
    (manifestIn(dir)?.targets ?? []).map(({ label, reusedFrom }) => [label, reusedFrom])
  );
  return labels.map((label) => ({
    label,
    reports: readReports(dir, label),
    scenarios: readScenarioLog(path.join(dir, `runs.${label}.jsonl`)),
    ...(reused.get(label) && { reusedFrom: reused.get(label) }),
  }));
}

type Summary = CapabilityReport["summary"];

/** The capability metrics a comparison carries, in report order. */
const METRICS: readonly { name: string; of: (summary: Summary) => number; unit?: "%" }[] = [
  { name: "answered", of: (summary) => summary.answered },
  { name: "claimed something", of: (summary) => summary.claimed ?? summary.tasks },
  { name: "grounded", of: (summary) => summary.grounded },
  { name: "refusals", of: (summary) => summary.refusals ?? 0 },
  { name: "fabrication rate", of: (summary) => summary.fabricationRate * 100, unit: "%" },
  { name: "blocked but answered", of: (summary) => summary.blockedButAnswered },
  { name: "honest refusals", of: (summary) => summary.honestRefusals },
  { name: "judged on complete data", of: (summary) => summary.judgedOnCompleteData },
  { name: "tool calls", of: (summary) => summary.totalToolCalls },
  { name: "tool calls refused", of: (summary) => summary.failedToolCalls ?? 0 },
  { name: "TomTom requests", of: (summary) => summary.totalUpstreamRequests ?? 0 },
  { name: "agent tokens", of: (summary) => summary.totalTokens },
  { name: "judge tokens", of: (summary) => summary.totalJudgeTokens ?? 0 },
];

/** One target, scored over its runs. */
export interface TargetScore {
  label: string;
  runs: number;
  model: string;
  /** `provider/model` of the judge, every one its runs had. */
  judge: string;
  /** True when a run's judge was the model under test. */
  selfJudged: boolean;
  tasks: number;
  capability: Record<string, NumericStats>;
  /** Per task: how many of the runs that asked it answered it, and were grounded. */
  perTask: Record<string, { answered: number; grounded: number; of: number; expected: string }>;
  scenarios?: ReturnType<typeof summarizeScenarios>;
  reusedFrom?: string;
}

const distinct = (values: readonly string[]): string =>
  [...new Set(values)].map((value) => value || "unrecorded").join(", ");

export function scoreTarget({ label, reports, scenarios, reusedFrom }: LoadedTarget): TargetScore {
  const perTask: TargetScore["perTask"] = {};
  for (const { id, answered, grounded, expected } of reports.flatMap(({ results }) => results)) {
    const entry = perTask[id] ?? { answered: 0, grounded: 0, of: 0, expected };
    perTask[id] = {
      ...entry,
      of: entry.of + 1,
      answered: entry.answered + Number(answered),
      grounded: entry.grounded + Number(grounded),
    };
  }
  return {
    label,
    runs: reports.length,
    model: distinct(reports.map(({ model }) => model)),
    judge: distinct(
      reports.map(
        ({ settings, judgeModel }) => `${settings?.judgeProvider ?? "?"}/${judgeModel || "?"}`
      )
    ),
    selfJudged: reports.some(
      ({ model, judgeModel }) => Boolean(judgeModel) && judgeModel === model
    ),
    tasks: reports[0]?.summary.tasks ?? 0,
    capability: Object.fromEntries(
      METRICS.map(({ name, of }) => [name, numericStats(reports.map(({ summary }) => of(summary)))])
    ),
    perTask,
    ...(scenarios.length && { scenarios: summarizeScenarios(scenarios) }),
    ...(reusedFrom && { reusedFrom }),
  };
}

/** Everything that keeps a sweep from being one comparison, each naming its run. */
export function sweepProblems(targets: readonly LoadedTarget[]): string[] {
  const runs = targets.flatMap(({ label, reports }) =>
    reports.map((report, index) => ({ name: `${label} run ${index + 1}`, report }))
  );
  const [first] = runs;
  const problems = runs.flatMap(({ name, report }) => [
    ...conditionMismatches(first.report, report).map(
      (problem) => `${name} against ${first.name}: ${problem}`
    ),
    ...(report.summary.notMeasured
      ? [`${name} did not score ${report.summary.notMeasured} task(s), so it covers fewer tasks`]
      : []),
  ]);
  // The scenario logs carry their own model ids; said once when the reports already differ.
  const logged = targets.filter(({ scenarios }) => scenarios.length);
  if (!problems.some((problem) => problem.includes("different models"))) {
    for (const { label, scenarios } of logged.slice(1)) {
      const problem = scenarioModelMismatch(logged[0].scenarios, scenarios);
      if (problem) problems.push(`${label} scenarios against ${logged[0].label}'s: ${problem}`);
    }
  }
  return [...new Set(problems)];
}

const row = (cells: readonly (string | number)[]): string => `| ${cells.join(" | ")} |`;

const header = (first: string, columns: readonly string[], align = "---:"): string[] => [
  row([first, ...columns]),
  row(["---", ...columns.map(() => align)]),
];

/** "12 (10–14)": a median and the range of the runs, the range left out for one run. */
const withRange = (stats: NumericStats, runs: number, unit = ""): string => {
  const value = `${formatNumber(stats.median)}${unit}`;
  return runs > 1 ? `${value} (${formatNumber(stats.min)}–${formatNumber(stats.max)})` : value;
};

const judgedBy = (score: TargetScore): string =>
  `${score.judge}${score.selfJudged ? " ⚠ self-judged" : ""}`;

/** Each later target against the first, then against the one before when that is another. */
const pairs = (scores: readonly TargetScore[]): [TargetScore, TargetScore][] =>
  scores
    .slice(1)
    .flatMap((score, index): [TargetScore, TargetScore][] => [
      [score, scores[0]],
      ...(index > 0 ? [[score, scores[index]] as [TargetScore, TargetScore]] : []),
    ]);

const mismatchBanner = (problems: readonly string[]): string[] =>
  problems.length
    ? [
        "> [!WARNING]",
        "> **These runs are not comparable.** The numbers below are printed so you can see",
        "> what to re-run — but do not quote them:",
        ...problems.map((problem) => `> - ${problem}`),
        ">",
        "> Re-record with the same models, judge, wiring, corpus, `EVAL_TASK_IDS` and settings,",
        "> and an `EVAL_MAX_TOKENS` that covers every task, or set `EVAL_ALLOW_MISMATCH=1` if",
        "> you mean to compare across them and will say so wherever you quote this.",
        "",
      ]
    : [];

function capabilitySection(scores: readonly TargetScore[]): string[] {
  const labels = scores.map(({ label }) => label);
  const lines = [
    "## Capability — medians, with the range over each target's runs",
    "",
    ...header("", labels),
    row(["runs", ...scores.map(({ runs }) => runs)]),
    row(["model", ...scores.map(({ model }) => model)]),
    row(["judged by", ...scores.map(judgedBy)]),
    ...METRICS.map(({ name, unit }) =>
      row([name, ...scores.map((score) => withRange(score.capability[name], score.runs, unit))])
    ),
    "",
    "> A wide range means the metric cannot separate the targets at this sample size.",
    ...(scores.some(({ selfJudged }) => selfJudged)
      ? ["> ⚠ self-judged: the model under test graded its own answers; `--judge` picks another."]
      : []),
    "",
  ];
  if (scores.length < 2) return lines;

  const compared = pairs(scores);
  lines.push(
    "## Each target against the first, and against the one before",
    "",
    "Differences of the medians above.",
    "",
    ...header(
      "",
      compared.map(([score, reference]) => `${score.label} vs ${reference.label}`)
    ),
    row([
      "judged by",
      ...compared.map(([score, reference]) =>
        judgedBy(score) === judgedBy(reference)
          ? judgedBy(score)
          : `${judgedBy(score)} vs ${judgedBy(reference)}`
      ),
    ]),
    ...METRICS.map(({ name, unit }) =>
      row([
        name,
        ...compared.map(
          ([score, reference]) =>
            `${signed(score.capability[name].median - reference.capability[name].median)}${unit ? "pp" : ""}`
        ),
      ])
    ),
    ""
  );
  return lines;
}

/** A task answered and grounded in most of a target's runs. */
const mostlyAnswered = (score: TargetScore, id: string): boolean => {
  const task = score.perTask[id];
  return Boolean(task) && Math.min(task.answered, task.grounded) > task.of / 2;
};

/** The tasks one target answers in most runs and the other does not, each way. */
function movedTasks(
  score: TargetScore,
  reference: TargetScore
): { gained: string[]; lost: string[] } {
  const ids = [...new Set([score, reference].flatMap(({ perTask }) => Object.keys(perTask)))];
  return {
    gained: ids.filter((id) => mostlyAnswered(score, id) && !mostlyAnswered(reference, id)),
    lost: ids.filter((id) => mostlyAnswered(reference, id) && !mostlyAnswered(score, id)),
  };
}

/** How one check reads for a target against its reference; `unclear` when it separates neither. */
type Reading = "better" | "worse" | "unclear";

/** Whether a target is better than its reference, and the checks that say so. */
export interface Verdict {
  target: string;
  reference: string;
  /** `mixed` when the checks point both ways; `unclear` when none separates the two. */
  verdict: Reading | "mixed";
  checks: { name: string; reference: string; target: string; reading: Reading; why: string }[];
  /** Tasks the reference answers in most runs and the target does not: the ones to read. */
  lost: string[];
  /**
   * Whether the target is no worse than the reference; undefined when a target has fewer than
   * two capability runs, which cannot say. Passing does not take being better.
   */
  pass?: boolean;
  /** What keeps it from passing, each one enough alone. */
  blockers: string[];
}

/** A metric whose runs all sit on one side of the reference's runs, read by which side is good. */
function byRange(
  score: TargetScore,
  reference: TargetScore,
  metric: string,
  higherIsBetter: boolean
): Pick<Verdict["checks"][number], "reading" | "why"> {
  if (Math.min(score.runs, reference.runs) < 2) {
    return { reading: "unclear", why: "one run cannot tell a difference from the judge's noise" };
  }
  const [target, base] = [score.capability[metric], reference.capability[metric]];
  const above = target.min > base.max;
  if (!above && target.max >= base.min) return { reading: "unclear", why: "the ranges overlap" };
  return {
    reading: above === higherIsBetter ? "better" : "worse",
    why: `every run ${above ? "above" : "below"} every ${reference.label} run`,
  };
}

type Check = Verdict["checks"][number];

/** Runs in which a target both answered a task and was grounded. */
const answeredRuns = (score: TargetScore, id: string): number =>
  Math.min(score.perTask[id]?.answered ?? 0, score.perTask[id]?.grounded ?? 0);

/**
 * Among the tasks lost, those lost by two runs or more: one run's difference is within what a
 * single judgement varies by.
 */
const clearlyLost = (score: TargetScore, reference: TargetScore, lost: readonly string[]) =>
  lost.filter((id) => answeredRuns(reference, id) - answeredRuns(score, id) >= 2);

/** What keeps `score` from passing against `reference`: a check that reads worse, or a task clearly lost. */
function blockersOf(
  score: TargetScore,
  reference: TargetScore,
  checks: readonly Check[],
  lost: readonly string[]
): string[] {
  const gone = clearlyLost(score, reference, lost);
  return [
    ...checks
      // The count of tasks is one run's difference at its edge; `gone` holds the clear ones.
      .filter(({ name, reading }) => reading === "worse" && !name.startsWith("tasks "))
      .map(({ name, why }) => `${name} is worse: ${why}`),
    ...(gone.length
      ? [
          `${reference.label} answers what ${score.label} lost by two runs or more: ${gone.join(", ")}`,
        ]
      : []),
  ];
}

/** Which way a count went: more of the good kind than the bad, or the reverse. */
const sideOf = (good: number, bad: number): Reading =>
  good === bad ? "unclear" : good > bad ? "better" : "worse";

/** The capability checks: the two judged metrics by range, then the tasks gained against lost. */
function capabilityChecks(score: TargetScore, reference: TargetScore): Check[] {
  if (!score.runs || !reference.runs) return [];
  const { gained, lost } = movedTasks(score, reference);
  const judged = [
    { name: "answered", higherIsBetter: true, unit: "" },
    { name: "fabrication rate", higherIsBetter: false, unit: "%" },
  ].map(({ name, higherIsBetter, unit }) => ({
    name,
    reference: withRange(reference.capability[name], reference.runs, unit),
    target: withRange(score.capability[name], score.runs, unit),
    ...byRange(score, reference, name, higherIsBetter),
  }));
  return [
    ...judged,
    {
      name: "tasks answered and grounded in most runs",
      reference: "",
      target: `${gained.length} gained, ${lost.length} lost`,
      reading: sideOf(gained.length, lost.length),
      why: gained.length === lost.length ? "as many gained as lost" : "more one way than the other",
    },
  ];
}

/** Tool selection accuracy, which no judge grades; not read across the two ways it is scored. */
function selectionCheck(score: TargetScore, reference: TargetScore): Check[] {
  const [after, before] = [score.scenarios, reference.scenarios];
  if (!after || !before) return [];
  const shown = (summary: typeof after) =>
    `${(summary.accuracy * 100).toFixed(1)}%${summary.metric === "accuracy" ? "" : "†"}`;
  const cells = { name: "tool selection accuracy", reference: shown(before), target: shown(after) };
  if (after.metric !== before.metric) {
    const why = "† is a tool family match, another metric, so not compared";
    return [{ ...cells, reading: "unclear", why }];
  }
  const reading = sideOf(after.accuracy, before.accuracy);
  const why = reading === "unclear" ? "the same" : "scored by the scenarios' checks, no judge";
  return [{ ...cells, reading, why }];
}

/**
 * Whether `score` is better than `reference`, from differences under one judge: the judge is
 * stricter than people, so a number on its own reads low, and the difference is what holds.
 * A metric counts only when every run of one target is past every run of the other.
 */
export function verdictOn(score: TargetScore, reference: TargetScore): Verdict {
  const checks = [...capabilityChecks(score, reference), ...selectionCheck(score, reference)];
  const readings = new Set(checks.map(({ reading }) => reading));
  const verdict =
    readings.has("better") && readings.has("worse")
      ? "mixed"
      : ((["worse", "better"] as const).find((reading) => readings.has(reading)) ?? "unclear");
  const { lost } = movedTasks(score, reference);
  const blockers = blockersOf(score, reference, checks, lost);
  const enoughRuns = Math.min(score.runs, reference.runs) >= 2;
  return {
    target: score.label,
    reference: reference.label,
    verdict,
    checks,
    lost,
    ...(enoughRuns && { pass: !blockers.length }),
    blockers,
  };
}

/** A verdict in one line: whether it passes, then how it compares. */
export const verdictLine = ({ target, reference, verdict, pass }: Verdict): string =>
  `${pass === undefined ? "No pass or fail on one run a side" : pass ? "PASS" : "FAIL"}: ` +
  {
    better: `${target} is better than ${reference}.`,
    worse: `${target} is worse than ${reference}.`,
    mixed: `${target} is better than ${reference} on some checks and worse on others.`,
    unclear: `no clear difference between ${target} and ${reference}.`,
  }[verdict];

/** Each later target against the first and the one before, or that the runs cannot be compared. */
function verdictSection(scores: readonly TargetScore[], problems: readonly string[]): string[] {
  if (scores.length < 2) return [];
  if (problems.length) {
    return ["## Verdict", "", "**No verdict: these runs are not comparable**, as said above.", ""];
  }
  return [
    "## Verdict",
    "",
    "From differences between targets under one judge, never a number on its own: the judge is",
    "stricter than people, on both targets alike. A metric counts when every run of one target",
    "is past every run of the other. A target passes when it is no worse than the one it is set",
    "against: no check reads worse, and no task that one answers is lost by two runs or more.",
    "",
    ...pairs(scores).flatMap(([score, reference]) => {
      const verdict = verdictOn(score, reference);
      return [
        `**${verdictLine(verdict)}**`,
        "",
        ...header("Check", [reference.label, score.label, "Reads as"], "---"),
        ...verdict.checks.map((check) =>
          row([check.name, check.reference, check.target, `${check.reading}: ${check.why}`])
        ),
        "",
        ...verdict.blockers.map((blocker) => `- Fails: ${blocker}.`),
        ...(verdict.blockers.length ? [""] : []),
        ...(verdict.lost.length
          ? [
              `Read first, answered by ${reference.label} in most runs and not by ${score.label}: ` +
                `${verdict.lost.join(", ")}.`,
              "",
            ]
          : []),
      ];
    }),
  ];
}

function perTaskSection(scores: readonly TargetScore[]): string[] {
  const ids = [...new Set(scores.flatMap(({ perTask }) => Object.keys(perTask)))];
  const expected = (id: string) => scores.find(({ perTask }) => perTask[id])?.perTask[id].expected;
  const lines = [
    "## Per task — runs that answered it · runs that were grounded",
    "",
    "A task answered in every run is a capability; one answered in half of them is a coin",
    "flip, and no single run can tell the two apart.",
    "",
    ...header("Task", ["expected", ...scores.map(({ label }) => label)], ":---:"),
    row(["judged by", "", ...scores.map(judgedBy)]),
    ...ids.map((id) =>
      row([
        id,
        expected(id) ?? "",
        ...scores.map(({ perTask }) => {
          const task = perTask[id];
          return task ? `${task.answered}/${task.of} · ${task.grounded}/${task.of}` : "not asked";
        }),
      ])
    ),
    "",
  ];
  const [first, ...rest] = scores;
  for (const score of rest) {
    const { gained, lost } = movedTasks(score, first);
    lines.push(
      `**${score.label} answers, in most runs, what ${first.label} does not:** ${gained.join(", ") || "none"}  `,
      `**${first.label} answers, in most runs, what ${score.label} does not:** ${lost.join(", ") || "none"}`,
      ""
    );
  }
  return lines;
}

function selectionSection(
  scores: readonly TargetScore[],
  targets: readonly LoadedTarget[]
): string[] {
  const logged = scores.filter((score) => score.scenarios);
  if (!logged.length) return [];
  const value = (
    score: TargetScore,
    get: (summary: NonNullable<TargetScore["scenarios"]>) => string | number
  ) => (score.scenarios ? get(score.scenarios) : "—");
  const lines = [
    "## Tool selection",
    "",
    "Each scenario is scored on its first attempt; scenario suites retry a failure twice,",
    "and a pass on a retry counts as flaky. A scenario the target's surface cannot express",
    "is left out of the denominator rather than counted as a failure.",
    "",
    ...header(
      "",
      logged.map(({ label }) => label)
    ),
    row(["graded by", ...logged.map(() => "the scenario's checks, no judge")]),
    row(["evaluated", ...logged.map((score) => value(score, ({ evaluated }) => evaluated))]),
    row([
      "not expressible on this surface",
      ...logged.map((score) =>
        value(score, ({ skippedUnrepresentable }) => skippedUnrepresentable)
      ),
    ]),
    row([
      "routed correctly, first attempt",
      ...logged.map((score) => value(score, ({ passed }) => passed)),
    ]),
    row([
      "accuracy",
      ...logged.map((score) =>
        value(
          score,
          ({ accuracy, metric }) =>
            `${(accuracy * 100).toFixed(1)}%${metric === "accuracy" ? "" : "†"}`
        )
      ),
    ]),
    row([
      "flaky: failed first, passed a retry",
      ...logged.map((score) => value(score, ({ flaky }) => flaky)),
    ]),
    row([
      "calls the server refused",
      ...logged.map((score) => value(score, ({ failedCalls }) => failedCalls)),
    ]),
    row([
      "mean hops",
      ...logged.map((score) => value(score, ({ meanHops }) => meanHops.toFixed(2))),
    ]),
    row([
      "median hops",
      ...logged.map((score) => value(score, ({ medianHops }) => formatNumber(medianHops))),
    ]),
    row([
      "tokens",
      ...logged.map((score) => value(score, ({ totalTokens }) => formatNumber(totalTokens))),
    ]),
    "",
    ...(logged.some(({ scenarios }) => scenarios?.metric !== "accuracy")
      ? [
          "† The legacy surface is scored with the order and argument checks off: a tool family",
          "match, not the same metric as accuracy.",
          "",
        ]
      : []),
  ];

  // Paired on prompt, test and model: the same prompt against two models is two observations.
  const byLabel = new Map(targets.map(({ label, scenarios }) => [label, firstAttempts(scenarios)]));
  const [first, ...rest] = logged;
  const firstRecords = byLabel.get(first.label) ?? [];
  for (const score of rest) {
    const after = new Map(
      (byLabel.get(score.label) ?? [])
        .filter(({ modelId }) => modelId)
        .map((record) => [scenarioKey(record), record])
    );
    const moved = firstRecords
      .flatMap((before) => {
        const record = before.modelId ? after.get(scenarioKey(before)) : undefined;
        return record && record.hops !== before.hops ? [{ before, after: record }] : [];
      })
      .sort((a, b) => b.before.hops - b.after.hops - (a.before.hops - a.after.hops));
    if (!moved.length) continue;
    lines.push(
      `### Prompts whose hop count moved, ${first.label} to ${score.label}`,
      "",
      ...header("Prompt", ["Model", first.label, score.label]),
      ...moved.map(({ before, after: record }) =>
        row([
          before.prompt.replace(/\|/g, "\\|"),
          before.modelId,
          `${before.hops} (${before.toolsCalled.join(" → ") || "none"})`,
          `${record.hops} (${record.toolsCalled.join(" → ") || "none"})`,
        ])
      ),
      ""
    );
  }

  for (const score of logged.filter(({ scenarios }) => scenarios?.metric === "accuracy")) {
    const misroutes = (byLabel.get(score.label) ?? []).filter(
      (record) => record.modelId && !record.passed && !record.unrepresentable?.length
    );
    if (!misroutes.length) continue;
    lines.push(
      `### Misroutes on ${score.label}`,
      "",
      ...misroutes.map(
        (record) => `- **${record.prompt}** _(${record.modelId})_ — ${record.problem}`
      ),
      ""
    );
  }
  return lines;
}

/**
 * The answer-quality metrics per target, from the judge's answers to the review form, pooled over
 * the target's runs; nothing for reports from before the judge answered it.
 */
function formMetricsSection(targets: readonly LoadedTarget[]): string[] {
  const columns = targets.flatMap(({ label, reports }) => {
    const results = reports.flatMap((report) => report.results);
    const metrics = metricsOfResults(results);
    const forms = results.flatMap(({ labels }) => (labels ? [labels] : []));
    return metrics ? [{ name: label, metrics, asked: questionsAnswered(forms) }] : [];
  });
  if (!columns.length) return [];
  return [
    "## Answer quality, from the judge's review forms (pooled over each target's runs)",
    "",
    metricsTable(columns),
    "",
  ];
}

/** The comparison of a sweep, as markdown. */
export function renderComparison(
  dir: string,
  targets: readonly LoadedTarget[],
  problems: readonly string[],
  generatedAt = new Date()
): string {
  const scores = targets.map(scoreTarget);
  const capability = scores.filter(({ runs }) => runs);
  const reused = scores.filter(({ reusedFrom }) => reusedFrom);
  const corpus = distinct(
    targets.flatMap(({ reports }) => reports.map(({ corpus }) => corpus ?? "standard"))
  );
  return `${[
    "# Eval comparison",
    "",
    ...mismatchBanner(problems),
    `Sweep \`${dir.startsWith(REPO_ROOT) ? path.relative(REPO_ROOT, dir) : dir}\` · ` +
      `${corpus || "no capability"} corpus · ` +
      `wiring ${distinct(targets.flatMap(({ reports }) => reports.map(({ mode }) => mode))) || "—"} · ` +
      `generated ${generatedAt.toISOString()}`,
    "",
    "Capability runs alternate by repeat (each target once, then each again) so drift in the",
    "live APIs or the model endpoint cannot land on one target and read as a result." +
      (reused.length
        ? ` ${reused.map(({ label, reusedFrom }) => `${label}'s runs come from \`${reusedFrom}\``).join("; ")}, ` +
          "so they were not alternated with the rest: trust a small difference less."
        : ""),
    "",
    ...verdictSection(scores, problems),
    ...(capability.length ? [...capabilitySection(capability), ...perTaskSection(capability)] : []),
    ...formMetricsSection(targets),
    ...selectionSection(scores, targets),
  ].join("\n")}\n`;
}

/** Writes a sweep's `comparison.md` and `results.json`; returns where, and its problems. */
export function writeComparison(dir: string, labels?: readonly string[]) {
  const targets = loadSweep(dir, labels ? [...labels] : undefined);
  if (!targets.some(({ reports, scenarios }) => reports.length || scenarios.length)) {
    throw new Error(`No reports or scenario logs in ${dir}.`);
  }
  const problems = sweepProblems(targets.filter(({ reports }) => reports.length));
  const generatedAt = new Date();
  const markdown = path.join(dir, "comparison.md");
  fs.writeFileSync(markdown, renderComparison(dir, targets, problems, generatedAt));
  const scores = targets.map(scoreTarget);
  const verdicts = problems.length
    ? []
    : pairs(scores).map(([score, reference]) => verdictOn(score, reference));
  fs.writeFileSync(
    path.join(dir, "results.json"),
    `${JSON.stringify(
      { sweep: path.basename(dir), generatedAt, problems, verdicts, targets: scores },
      null,
      2
    )}\n`
  );
  return { markdown, problems, verdicts };
}

/** The newest sweep directory with anything in it. */
const newestSweep = (): string => {
  const sweeps = fs.existsSync(SWEEPS_DIR)
    ? fs
        .readdirSync(SWEEPS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map(({ name }) => path.join(SWEEPS_DIR, name))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    : [];
  if (!sweeps.length)
    throw new Error(`No sweep under ${SWEEPS_DIR}: run \`pnpm evals:run\` first.`);
  return sweeps[0];
};

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { labels: { type: "string" } },
  });
  const dir = positionals[0] ? path.resolve(positionals[0]) : newestSweep();
  const { markdown, problems, verdicts } = writeComparison(
    dir,
    values.labels ? splitList(values.labels) : undefined
  );
  console.log(`written → ${markdown}`);
  for (const verdict of verdicts) console.log(`verdict → ${verdictLine(verdict)}`);
  if (!problems.length) return;

  // Written first, then refused: the file is what says which run to re-record.
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  if (process.env.EVAL_ALLOW_MISMATCH === "1") {
    console.error("\n  EVAL_ALLOW_MISMATCH=1 — continuing anyway.\n");
    return;
  }
  console.error(
    "\n  Refusing to report these runs as one comparison; EVAL_ALLOW_MISMATCH=1 overrides.\n"
  );
  process.exitCode = 1;
}

// Only when run as a script: `harness/comparison.test.ts` imports the functions above.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
