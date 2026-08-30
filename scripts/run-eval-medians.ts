/**
 * Runs the capability benchmark N times per surface and reports the median.
 *
 * One run of a 13-task benchmark is not a measurement. Repeat runs of the SAME
 * surface have come back four tasks apart on `answered` — wider than the gap
 * between the two surfaces — so a single pair of numbers cannot separate "this
 * surface is better" from "this run went better".
 *
 * Runs are INTERLEAVED (baseline, current, baseline, current, …) rather than
 * grouped. The live APIs and the model endpoint both vary over the hour, and
 * running five of one and then five of the other would let that drift land
 * entirely on one surface and read as a result.
 *
 *   pnpm evals:medians
 *   EVAL_REPEAT=3 pnpm evals:medians
 *
 * Each run's report is archived to `evals/capability/runs/`, so the spread can
 * be re-examined without re-running, and the medians are written to
 * `evals/capability/medians.md`.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));
const CAPABILITY_DIR = path.resolve(ROOT_DIR, "evals/capability");
/**
 * One directory per sweep, named for when it started.
 *
 * Archives used to be keyed by run number alone, so the next sweep overwrote the
 * evidence behind the last one — including a sweep that aborted halfway, which
 * silently replaced run 1 of a complete set. The roll-up survives in
 * `medians.md`, but the runs it was computed from did not.
 */
const SWEEP_ID = new Date().toISOString().replace(/[:.]/g, "-");
const RUNS_DIR = path.join(CAPABILITY_DIR, "runs", SWEEP_ID);

const REPEAT = Number(process.env.EVAL_REPEAT ?? 5);
const LABELS = ["baseline", "current"] as const;
type Label = (typeof LABELS)[number];

/**
 * Which surfaces to actually run. `EVAL_MEDIAN_LABELS=current` skips the
 * baseline, which is worth doing only alongside EVAL_MEDIAN_BASELINE_FROM: the
 * baseline is unchanged code, so re-measuring it costs half the sweep to
 * re-derive a number already recorded.
 */
const LABELS_TO_RUN = (process.env.EVAL_MEDIAN_LABELS ?? LABELS.join(","))
  .split(",")
  .map((label) => label.trim())
  .filter(Boolean) as Label[];

/**
 * Sweep directories to take baseline runs from instead of re-running them.
 *
 * Only valid while the baseline checkout, the corpus and the JUDGE are
 * unchanged — a judge revision rescores both surfaces, so pooling across one
 * compares two different measurements. The reuse is named in `medians.md` rather
 * than left for a reader to infer, because a reused baseline is not interleaved
 * with the runs it is compared against, and interleaving is the thing that keeps
 * drift off one surface.
 */
const BASELINE_FROM = (process.env.EVAL_MEDIAN_BASELINE_FROM ?? "")
  .split(",")
  .map((dir) => dir.trim())
  .filter(Boolean);

interface TaskResult {
  id: string;
  answered?: boolean;
  grounded?: boolean;
  expected?: string;
}

interface Report {
  model?: string;
  mode?: string;
  summary: Record<string, number>;
  results: TaskResult[];
}

const reportPath = (label: Label) => path.join(CAPABILITY_DIR, `report.${label}.json`);
const archivePath = (label: Label, run: number) => path.join(RUNS_DIR, `report.${label}.${run}.json`);

/** Median of a list. Even counts average the two middle values. */
const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const range = (values: readonly number[]): string => {
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high ? `${low}` : `${low}–${high}`;
};

fs.mkdirSync(RUNS_DIR, { recursive: true });

/** How many tasks a just-written report failed to score. */
const notMeasuredIn = (label: Label): number => {
  try {
    return JSON.parse(fs.readFileSync(reportPath(label), "utf-8")).summary?.notMeasured ?? 0;
  } catch {
    return 0;
  }
};

for (let run = 1; run <= REPEAT; run += 1) {
  for (const label of LABELS_TO_RUN) {
    const target = reportPath(label);
    let before = fs.existsSync(target) ? fs.statSync(target).mtimeMs : null;
    let status: number | null = null;
    let after: number | null = null;

    // One retry. A run is thirteen live tasks against two flaky networks, and
    // losing a ten-run sweep because one task hit a DNS blip is a worse outcome
    // than paying for one repeat. A run that comes back incomplete twice is a
    // real problem and is left to the completeness check.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      console.log(
        `\n─── run ${run}/${REPEAT}  ${label}${attempt > 1 ? "  (retry)" : ""}\n`
      );
      ({ status } = spawnSync("pnpm", ["run", `evals:capability:${label}`], {
        cwd: ROOT_DIR,
        stdio: "inherit",
      }));
      after = fs.existsSync(target) ? fs.statSync(target).mtimeMs : null;

      const missing = after !== null && after !== before ? notMeasuredIn(label) : 0;
      if (missing === 0) break;
      console.log(`\n  ${label} run ${run} scored ${missing} task(s) short — repeating it.`);
      before = after;
    }

    if (after === null || after === before) {
      console.error(
        `\n✗ ${label} run ${run} exited ${status ?? "abnormally"} without rewriting ` +
          `${path.relative(ROOT_DIR, target)}. Nothing was recorded; stopping rather than ` +
          `taking a median over a run that did not happen.\n`
      );
      process.exit(1);
    }

    fs.copyFileSync(target, archivePath(label, run));
    // A non-zero exit is the normal case here: some tasks are expected to fail.
    if (status !== 0) console.log(`\n  ${label} run ${run} exited ${status} — recorded.`);
  }
}

const readReports = (dir: string, label: Label): Report[] =>
  fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(`report.${label}.`) && name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8")));

const load = (label: Label): Report[] => {
  if (LABELS_TO_RUN.includes(label)) return readReports(RUNS_DIR, label);
  if (label === "baseline" && BASELINE_FROM.length) {
    return BASELINE_FROM.flatMap((dir) =>
      readReports(path.resolve(CAPABILITY_DIR, "runs", dir), label)
    );
  }
  throw new Error(
    `No runs for "${label}": it was not in EVAL_MEDIAN_LABELS and no EVAL_MEDIAN_BASELINE_FROM ` +
      "sweep was given to reuse."
  );
};

/**
 * A run that could not score every task is not a member of this sample.
 *
 * A model endpoint timing out on one task leaves that run covering 12 of 13, and
 * a median that mixes 12-task runs with 13-task ones is arithmetic over two
 * different corpora. Better to say the sweep is incomplete than to publish it.
 */
const assertComplete = (label: Label, reports: readonly Report[]): void => {
  const incomplete = reports
    .map((report, index) => ({ run: index + 1, missing: report.summary.notMeasured ?? 0 }))
    .filter(({ missing }) => missing > 0);
  if (!incomplete.length) return;

  console.error(
    `\n✗ ${label}: ${incomplete.length} of ${reports.length} runs did not score every task ` +
      `(${incomplete.map(({ run, missing }) => `run ${run}: ${missing} missing`).join(", ")}).\n\n` +
      "  Those runs cover a smaller corpus than the rest, so a median over them\n" +
      "  would average two different denominators. Re-run the sweep once the\n" +
      "  model endpoint and the live APIs are answering reliably.\n"
  );
  process.exit(1);
};

const runs: Record<Label, Report[]> = { baseline: load("baseline"), current: load("current") };
for (const label of LABELS) assertComplete(label, runs[label]);

const METRICS = [
  "answered",
  "grounded",
  "blockedButAnswered",
  "honestRefusals",
  "judgedOnCompleteData",
  "totalTokens",
] as const;

const seriesOf = (label: Label, metric: string) =>
  runs[label].map((report) => report.summary[metric] ?? 0);

const rows = METRICS.map((metric) => {
  const before = seriesOf("baseline", metric);
  const after = seriesOf("current", metric);
  const [medianBefore, medianAfter] = [median(before), median(after)];
  return `| ${metric} | ${medianBefore.toLocaleString()} | ${range(before)} | ${medianAfter.toLocaleString()} | ${range(after)} | ${
    medianAfter - medianBefore > 0 ? "+" : ""
  }${(medianAfter - medianBefore).toLocaleString()} |`;
});

/** How often each task was answered, which is where the spread actually lives. */
const taskRows = runs.current[0].results.map((task) => {
  // Denominator is the runs that ASKED this task, not every run. A task added to
  // the corpus after a reused baseline was recorded is absent from those reports,
  // and counting it 0/10 would read as "the baseline never managed it" when the
  // baseline was never asked.
  const count = (label: Label, field: "answered" | "grounded") => {
    const asked = runs[label].filter((report) => report.results.some((r) => r.id === task.id));
    if (!asked.length) return "not asked";
    return `${asked.filter((report) => report.results.find((r) => r.id === task.id)?.[field]).length}/${asked.length}`;
  };
  return `| ${task.id} | ${task.expected ?? ""} | ${count("baseline", "answered")} | ${count("current", "answered")} | ${count("baseline", "grounded")} | ${count("current", "grounded")} |`;
});

const first = runs.current[0];
const reusedBaseline = !LABELS_TO_RUN.includes("baseline");
const provenance = reusedBaseline
  ? `Current: ${runs.current.length} runs from this sweep, \`evals/capability/runs/${SWEEP_ID}/\`.
Baseline: ${runs.baseline.length} runs REUSED from ${BASELINE_FROM.map((d) => `\`${d}\``).join(", ")},
recorded earlier against the same unchanged checkout, corpus and judge.

The two halves were therefore NOT interleaved. Interleaving is what keeps drift in
the live APIs or the model endpoint off one surface, so treat a small delta here
with more suspicion than one from a paired sweep; the ranges are the guide.`
  : `Runs were interleaved (baseline, current, baseline, …) so drift in the live APIs
or the model endpoint cannot land on one surface and read as a result. Each run's
report is in \`evals/capability/runs/${SWEEP_ID}/\`.`;

const markdown = `# Capability benchmark — median of repeated runs

Model: ${first.model ?? "unknown"} · wiring: ${first.mode ?? "unknown"} · generated ${new Date().toISOString()}

${provenance}

## Medians — baseline over ${runs.baseline.length} runs, current over ${runs.current.length}

| Metric | baseline median | baseline range | current median | current range | Δ median |
| --- | ---: | ---: | ---: | ---: | ---: |
${rows.join("\n")}

## Per task — how many runs answered it

A task answered in every run is a capability; one answered in half of them is a
coin flip, and no single run can tell them apart.

| Task | expected | baseline answered | current answered | baseline grounded | current grounded |
| --- | --- | ---: | ---: | ---: | ---: |
${taskRows.join("\n")}
`;

const out = path.join(CAPABILITY_DIR, "medians.md");
fs.writeFileSync(out, markdown);
console.log(`\nwritten → ${out}\n`);
console.log(markdown);
