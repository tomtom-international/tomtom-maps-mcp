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
 * Rolls a phase sweep up into one comparable table.
 *
 *   npx tsx evals/compare-phases.ts evals/capability/runs/phases-<sweep>
 *
 * Every phase is reported twice: against phase 0 (what the whole exercise
 * bought) and against the phase before it (what THIS step bought). The second
 * is the one that can be acted on — it is the only view in which a step that
 * cost tokens and returned nothing is visible, because a cumulative total hides
 * it behind the step before.
 *
 * Capability metrics are MEDIANS over the sweep's repeats, with the observed
 * range beside them. A median with a range of 8–13 is not a measurement anyone
 * should make a decision from, and printing the range is what makes that
 * obvious rather than discoverable.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readScenarioLog, summarizeScenarios } from "./harness/scenario-log";
import { PHASES } from "./phases";

const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));
const RUNS_DIR = path.resolve(process.argv[2] ?? "");
if (!fs.existsSync(RUNS_DIR)) throw new Error(`No sweep directory at ${RUNS_DIR}`);

interface TaskResult {
  id: string;
  capability?: string;
  expected?: string;
  answered?: boolean;
  grounded?: boolean;
  tokens?: number;
  toolsCalled?: string[];
}
interface Report {
  model?: string;
  summary: Record<string, number>;
  results: TaskResult[];
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const rangeOf = (values: readonly number[]): [number, number] => [
  Math.min(...values),
  Math.max(...values),
];

const reportsFor = (id: string): Report[] =>
  fs
    .readdirSync(RUNS_DIR)
    .filter((name) => name.startsWith(`report.${id}.`) && name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(RUNS_DIR, name), "utf-8")) as Report);

/** Capability metrics carried across every phase, in report order. */
const METRICS = [
  "answered",
  "grounded",
  "blockedButAnswered",
  "honestRefusals",
  "judgedOnCompleteData",
  "totalTokens",
] as const;

interface PhaseScore {
  id: string;
  ordinal: number;
  title: string;
  adds: string;
  modelVisibleTools: number;
  intent: string;
  runs: number;
  model?: string;
  tasks: number;
  capability: Record<string, { median: number; range: [number, number]; values: number[] }>;
  /** Per task: how many of this phase's runs answered it. */
  perTask: Record<string, { answered: number; grounded: number; of: number; expected?: string }>;
  scenarios?: ReturnType<typeof summarizeScenarios>;
}

const score = (phase: (typeof PHASES)[number]): PhaseScore | undefined => {
  const reports = reportsFor(phase.id);
  if (reports.length === 0) return undefined;

  const capability: PhaseScore["capability"] = {};
  for (const metric of METRICS) {
    const values = reports.map((r) => r.summary[metric] ?? 0);
    capability[metric] = { median: median(values), range: rangeOf(values), values };
  }

  const perTask: PhaseScore["perTask"] = {};
  for (const report of reports) {
    for (const result of report.results) {
      const entry = (perTask[result.id] ??= {
        answered: 0,
        grounded: 0,
        of: 0,
        expected: result.expected,
      });
      entry.of += 1;
      if (result.answered) entry.answered += 1;
      if (result.grounded) entry.grounded += 1;
    }
  }

  const scenarioLog = path.join(RUNS_DIR, `runs.${phase.id}.jsonl`);
  const scenarios = fs.existsSync(scenarioLog)
    ? summarizeScenarios(readScenarioLog(scenarioLog))
    : undefined;

  return {
    id: phase.id,
    ordinal: phase.ordinal,
    title: phase.title,
    adds: phase.adds,
    modelVisibleTools: phase.modelVisibleTools,
    intent: phase.intent,
    runs: reports.length,
    model: reports[0]?.model,
    tasks: reports[0]?.results.length ?? 0,
    capability,
    perTask,
    scenarios,
  };
};

const scored = PHASES.map(score).filter((s): s is PhaseScore => s !== undefined);
if (scored.length === 0) throw new Error(`No phase reports found in ${RUNS_DIR}`);

const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);
const fmt = (n: number): string => (Number.isInteger(n) ? `${n}` : n.toFixed(1));
const rangeText = (r: [number, number]): string => (r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`);

const lines: string[] = [];
lines.push("# Phase comparison");
lines.push("");
lines.push(
  `Model: ${scored[0].model ?? "unknown"} · wiring: stdio · ` +
    `${scored[0].runs} capability run(s) per phase · generated ${new Date().toISOString()}`
);
lines.push("");
lines.push(
  "Runs were interleaved (phase 0, 1, 2, 3 · phase 0, 1, 2, 3 · …) so drift in the live",
  "APIs cannot land on one phase and read as a result. Capability figures are medians;",
  "the range beside each is the spread across repeats, and a wide one means the metric",
  "cannot separate these phases at this sample size."
);
lines.push("");

lines.push("## What each phase adds");
lines.push("");
lines.push("| Phase | Adds | Model-visible tools |");
lines.push("| --- | --- | ---: |");
for (const s of scored) {
  lines.push(`| **${s.ordinal}. ${s.title}** | ${s.adds} | ${s.modelVisibleTools} |`);
}
lines.push("");

lines.push("## Capability — medians");
lines.push("");
const header = ["Metric", ...scored.map((s) => `${s.id} (median)`)];
lines.push(`| ${header.join(" | ")} |`);
lines.push(`| --- |${scored.map(() => " ---: |").join("")}`);
for (const metric of METRICS) {
  const cells = scored.map((s) => {
    const m = s.capability[metric];
    return `${fmt(m.median)} <sub>${rangeText(m.range)}</sub>`;
  });
  lines.push(`| ${metric} | ${cells.join(" | ")} |`);
}
lines.push("");

lines.push("## Each phase against phase 0, and against the phase before it");
lines.push("");
// Phase 1's predecessor IS phase 0, so a "vs previous" column for it would repeat
// the "vs 0" column verbatim. Only the phases where the two differ get both.
const comparisons = scored
  .slice(1)
  .flatMap((s) =>
    s.ordinal === 1 ? [[s, 0] as const] : [[s, 0] as const, [s, s.ordinal - 1] as const]
  );
lines.push(`| Metric | ${comparisons.map(([s, base]) => `${s.id} vs ${base}`).join(" | ")} |`);
lines.push(`| --- |${comparisons.map(() => " ---: |").join("")}`);
for (const metric of METRICS) {
  const cells = comparisons.map(([s, base]) => {
    const against = scored.find((p) => p.ordinal === base);
    return signed(s.capability[metric].median - (against?.capability[metric].median ?? 0));
  });
  lines.push(`| ${metric} | ${cells.join(" | ")} |`);
}
lines.push("");

lines.push("## Per task — runs that answered it");
lines.push("");
lines.push(
  "A task answered in every run is a capability. One answered in half of them is a coin",
  "flip, and no single run can tell the two apart."
);
lines.push("");
const taskIds = Object.keys(scored[0].perTask);
lines.push(`| Task | expected | ${scored.map((s) => s.id).join(" | ")} |`);
lines.push(`| --- | --- |${scored.map(() => " :---: |").join("")}`);
for (const id of taskIds) {
  const cells = scored.map((s) => {
    const t = s.perTask[id];
    return t ? `${t.answered}/${t.of}` : "—";
  });
  lines.push(`| ${id} | ${scored[0].perTask[id]?.expected ?? ""} | ${cells.join(" | ")} |`);
}
lines.push("");

if (scored.some((s) => s.scenarios)) {
  lines.push("## Tool selection");
  lines.push("");
  lines.push(
    "A scenario the target surface cannot express is excluded from the denominator rather",
    "than counted as a failure — scoring a phase for not calling a tool it does not carry",
    "would manufacture an improvement out of a tautology."
  );
  lines.push("");
  const rows = [
    ["evaluated", (s: PhaseScore) => s.scenarios?.evaluated],
    ["not expressible", (s: PhaseScore) => s.scenarios?.skippedUnrepresentable],
    ["routed correctly", (s: PhaseScore) => s.scenarios?.passed],
    [
      "accuracy",
      (s: PhaseScore) => (s.scenarios ? `${(s.scenarios.accuracy * 100).toFixed(1)}%` : undefined),
    ],
    ["mean hops", (s: PhaseScore) => s.scenarios?.meanHops.toFixed(2)],
    ["median hops", (s: PhaseScore) => s.scenarios?.medianHops],
    ["total tokens", (s: PhaseScore) => s.scenarios?.totalTokens.toLocaleString()],
  ] as const;
  lines.push(`| Metric | ${scored.map((s) => s.id).join(" | ")} |`);
  lines.push(`| --- |${scored.map(() => " ---: |").join("")}`);
  for (const [name, get] of rows) {
    lines.push(`| ${name} | ${scored.map((s) => get(s) ?? "—").join(" | ")} |`);
  }
  lines.push("");
}

const markdown = `${lines.join("\n")}\n`;
fs.writeFileSync(path.join(ROOT_DIR, "evals/phase-comparison.md"), markdown);
fs.writeFileSync(
  path.join(ROOT_DIR, "evals/phase-results.json"),
  `${JSON.stringify({ sweep: path.basename(RUNS_DIR), generatedAt: new Date().toISOString(), phases: scored }, null, 2)}\n`
);
console.log(markdown);
console.log("wrote evals/phase-comparison.md and evals/phase-results.json");
