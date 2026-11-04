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
 * Runs the evals against each checkout and reports them side by side:
 *
 *   pnpm evals:run                                    # baseline and current, 3 capability runs each
 *   pnpm evals:run --repeats 1 --suites capability
 *   pnpm evals:run --phases all --corpus demanding
 *   pnpm evals:run --target main=../tomtom-mcp-baseline --target pr=.:consolidated
 *
 * `pnpm evals:run --help` lists the options (`evals/sweep.ts`). Capability runs alternate by
 * repeat (each target once, then each again) rather than grouping by target: the live APIs and
 * the model endpoint drift over the hour, and grouped runs would land that drift on one
 * target. Scenarios run once per target, after them.
 *
 * Each run must rewrite its artefact: one that dies before recording (no key, no `dist/`)
 * leaves the previous run's file, which the report would read as this one's. A non-zero exit
 * with a rewritten artefact is the normal case, a task or a prompt that failed, and is kept.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { writeComparison } from "../evals/compare";
import {
  notMeasuredIn,
  reportFiles,
  stampOf,
  SWEEPS_DIR,
  sweepId,
  unrunByBudgetIn,
} from "../evals/harness/reports";
import { assertFreshBuild } from "../evals/harness/stdio-session";
import { REPO_ROOT } from "../evals/harness/target";
import { manifestOf, planSweep, type Suite, type SweepPlan, type SweepTarget } from "../evals/sweep";

/** Where a run of `suite` against `label` leaves its artefact. */
const artefactOf = (suite: Suite, label: string): string =>
  suite === "capability"
    ? path.join(REPO_ROOT, "evals", "capability", `report.${label}.json`)
    : path.join(REPO_ROOT, "evals", "scenarios", `runs.${label}.jsonl`);

type Outcome = { recorded: true; status: number | null } | { recorded: false; reason: string };

/**
 * Runs one suite against one target, once more when it records nothing or, for capability,
 * leaves tasks not measured; a run that spent its token budget is not repeated.
 */
function runSuite(plan: SweepPlan, target: SweepTarget, suite: Suite): Outcome {
  const artefact = artefactOf(suite, target.label);
  let before = stampOf(artefact);
  let reason = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (attempt > 1) console.log(`\n  ${target.label} ${suite}: ${reason} — running it again.\n`);
    const { status } = spawnSync(
      "pnpm",
      ["exec", "vitest", "run", "--config", "evals/vitest.config.ts", `evals/${suite}`],
      {
        cwd: REPO_ROOT,
        stdio: "inherit",
        env: {
          ...process.env,
          ...plan.env,
          EVAL_SERVER_ROOT: target.root,
          EVAL_LABEL: target.label,
          EVAL_SURFACE: target.surface,
        },
      }
    );
    const after = stampOf(artefact);
    if (after === null || after === before) {
      reason = `exited ${status ?? "abnormally"} without rewriting ${path.relative(REPO_ROOT, artefact)}`;
      continue;
    }
    if (suite === "scenarios") return { recorded: true, status };
    const unrun = unrunByBudgetIn(artefact);
    if (unrun) {
      return {
        recorded: false,
        reason: `spent its EVAL_MAX_TOKENS budget with ${unrun} task(s) unrun, which a repeat would spend again`,
      };
    }
    const missing = notMeasuredIn(artefact);
    if (!missing) return { recorded: true, status };
    reason = `left ${missing} task(s) not measured`;
    before = after;
  }
  return { recorded: false, reason: `${reason}, twice` };
}

function record(plan: SweepPlan, target: SweepTarget, suite: Suite, copyTo: string): void {
  const outcome = runSuite(plan, target, suite);
  if (!outcome.recorded) {
    console.error(
      `\n✗ ${target.label} ${suite} ${outcome.reason}. Stopping rather than reporting a run that ` +
        "did not happen; the sweep's runs so far are kept.\n"
    );
    process.exit(1);
  }
  fs.copyFileSync(artefactOf(suite, target.label), copyTo);
  if (outcome.status !== 0) {
    console.log(`\n  ${target.label} ${suite} exited ${outcome.status}: recorded, failures included.`);
  }
}

/** Copies a reused target's runs, and its scenario log when there is one, into this sweep. */
function copyReused({ label, reusedFrom }: SweepTarget, dir: string): void {
  if (!reusedFrom) return;
  const log = `runs.${label}.jsonl`;
  const names = [...reportFiles(reusedFrom, label), ...(fs.existsSync(path.join(reusedFrom, log)) ? [log] : [])];
  for (const name of names) fs.copyFileSync(path.join(reusedFrom, name), path.join(dir, name));
}

function main(): void {
  let plan: SweepPlan;
  try {
    plan = planSweep(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  const live = plan.targets.filter(({ reusedFrom }) => !reusedFrom);
  for (const target of live) assertFreshBuild({ ...target, isBaseline: target.root !== REPO_ROOT });
  for (const warning of plan.warnings) console.warn(`⚠ ${warning}`);

  const startedAt = new Date();
  const dir = path.join(SWEEPS_DIR, sweepId(startedAt));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "sweep.json"), `${JSON.stringify(manifestOf(plan, startedAt), null, 2)}\n`);
  for (const target of plan.targets) copyReused(target, dir);
  console.log(
    `sweep ${path.relative(REPO_ROOT, dir)}\n` +
      `targets: ${plan.targets.map(({ label, reusedFrom }) => (reusedFrom ? `${label} (reused)` : label)).join(", ")}\n` +
      `${plan.corpus} corpus, ${plan.repeats} capability run(s) each, suites: ${plan.suites.join(", ")}\n`
  );

  if (plan.suites.includes("capability")) {
    for (let run = 1; run <= plan.repeats; run += 1) {
      for (const target of live) {
        console.log(`\n─── capability  run ${run}/${plan.repeats}  ${target.label}\n`);
        record(plan, target, "capability", path.join(dir, `report.${target.label}.${run}.json`));
      }
    }
  }
  if (plan.suites.includes("scenarios")) {
    for (const target of live) {
      console.log(`\n─── scenarios  ${target.label}\n`);
      record(plan, target, "scenarios", path.join(dir, `runs.${target.label}.jsonl`));
    }
  }

  const { markdown, problems } = writeComparison(dir);
  console.log(`\nwritten → ${markdown}`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  if (problems.length && process.env.EVAL_ALLOW_MISMATCH !== "1") process.exitCode = 1;
}

main();
