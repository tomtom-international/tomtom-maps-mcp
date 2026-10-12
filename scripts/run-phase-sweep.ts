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
 * Scores every phase in `evals/phases.ts` with one corpus, one judge, one model.
 *
 *   pnpm evals:phases                 # 3 capability repeats + 1 scenario run each
 *   EVAL_REPEAT=1 pnpm evals:phases   # a cheaper smoke of the same pipeline
 *   EVAL_PHASES=phase1,phase2 pnpm evals:phases
 *
 * Runs are INTERLEAVED by repeat (0,1,2,3 · 0,1,2,3 · …) rather than grouped by
 * phase. The corpus hits live traffic and search APIs, whose contents change
 * through the day; running one phase to completion before starting the next
 * would let that drift land entirely on one phase and read as a result.
 *
 * Capability is repeated because it is noisy — the same code has scored 8 and 13
 * answered on different runs — so a single run cannot tell a real gain from a
 * coin flip. Tool SELECTION is not repeated by default: it varies far less, and
 * phases 1 and 2 advertise byte-identical tool lists, so a second run mostly buys
 * a second copy of the same answer.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PHASES } from "../evals/phases";

const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));
const CAPABILITY_DIR = path.resolve(ROOT_DIR, "evals/capability");
const SCENARIO_DIR = path.resolve(ROOT_DIR, "evals/scenarios");

/** One directory per sweep, so a later sweep never overwrites this one's evidence. */
const SWEEP_ID = new Date().toISOString().replace(/[:.]/g, "-");
const RUNS_DIR = path.join(CAPABILITY_DIR, "runs", `phases-${SWEEP_ID}`);

const REPEAT = Number(process.env.EVAL_REPEAT ?? 3);
const WANTED = (process.env.EVAL_PHASES ?? PHASES.map((p) => p.id).join(","))
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const SELECTED = PHASES.filter((phase) => WANTED.includes(phase.id));
const WITH_SCENARIOS = process.env.EVAL_SKIP_SCENARIOS !== "1";

if (SELECTED.length === 0) throw new Error(`No phases matched EVAL_PHASES="${WANTED.join(",")}".`);

const reportPath = (id: string) => path.join(CAPABILITY_DIR, `report.${id}.json`);
const scenarioPath = (id: string) => path.join(SCENARIO_DIR, `runs.${id}.jsonl`);
const stampOf = (file: string): number | null =>
  fs.existsSync(file) ? fs.statSync(file).mtimeMs : null;

/** Environment a phase is measured under. Only the target changes between them. */
const envFor = (phase: (typeof PHASES)[number]) => ({
  ...process.env,
  EVAL_TRANSPORT: "stdio",
  EVAL_SERVER_ROOT: phase.root,
  EVAL_LABEL: phase.id,
  EVAL_SURFACE: phase.surface,
});

/** How many tasks a just-written report failed to score. */
const notMeasuredIn = (id: string): number => {
  try {
    return JSON.parse(fs.readFileSync(reportPath(id), "utf-8")).summary?.notMeasured ?? 0;
  } catch {
    return 0;
  }
};

interface Attempt {
  ok: boolean;
  status: number | null;
}

/**
 * Runs one suite against one phase, insisting it rewrote its artefact.
 *
 * A non-zero exit is normal — the corpus contains tasks a phase is expected to
 * fail. An artefact that did NOT change is not: it means the suite died before
 * recording anything, and the stale file on disk would otherwise be read as this
 * run's result.
 */
const runSuite = (
  phase: (typeof PHASES)[number],
  suite: "capability" | "scenarios",
  artefact: string,
  attempts = 2
): Attempt => {
  let before = stampOf(artefact);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { status } = spawnSync(
      "npx",
      ["vitest", "run", "--config", "evals/vitest.config.ts", `evals/${suite}`],
      { cwd: ROOT_DIR, stdio: "inherit", env: envFor(phase) }
    );
    const after = stampOf(artefact);
    if (after !== null && after !== before) {
      const missing = suite === "capability" ? notMeasuredIn(phase.id) : 0;
      if (missing === 0) return { ok: true, status };
      console.log(`\n  ${phase.id} scored ${missing} task(s) short — repeating it.`);
      before = after;
      continue;
    }
    console.log(`\n  ${phase.id} ${suite} recorded nothing (exit ${status}) — retrying.`);
  }
  return { ok: false, status: null };
};

fs.mkdirSync(RUNS_DIR, { recursive: true });
console.log(
  `sweep ${SWEEP_ID}\nphases: ${SELECTED.map((p) => p.id).join(", ")}\n` +
    `capability repeats: ${REPEAT}   scenarios: ${WITH_SCENARIOS ? "once each" : "skipped"}\n`
);

for (let run = 1; run <= REPEAT; run += 1) {
  for (const phase of SELECTED) {
    console.log(`\n─── capability  run ${run}/${REPEAT}  ${phase.id} (${phase.title})\n`);
    const attempt = runSuite(phase, "capability", reportPath(phase.id));
    if (!attempt.ok) {
      console.error(
        `\n✗ ${phase.id} run ${run} recorded nothing. Stopping rather than taking a median ` +
          "over a run that did not happen.\n"
      );
      process.exit(1);
    }
    fs.copyFileSync(reportPath(phase.id), path.join(RUNS_DIR, `report.${phase.id}.${run}.json`));
  }
}

if (WITH_SCENARIOS) {
  for (const phase of SELECTED) {
    console.log(`\n─── scenarios  ${phase.id} (${phase.title})\n`);
    const attempt = runSuite(phase, "scenarios", scenarioPath(phase.id));
    if (!attempt.ok) {
      console.error(`\n✗ ${phase.id} scenarios recorded nothing.\n`);
      process.exit(1);
    }
    fs.copyFileSync(scenarioPath(phase.id), path.join(RUNS_DIR, `runs.${phase.id}.jsonl`));
  }
}

console.log(`\nsweep complete — evidence in ${path.relative(ROOT_DIR, RUNS_DIR)}\n`);
const rollup = spawnSync("npx", ["tsx", "evals/compare-phases.ts", RUNS_DIR], {
  cwd: ROOT_DIR,
  stdio: "inherit",
});
process.exit(rollup.status ?? 0);
