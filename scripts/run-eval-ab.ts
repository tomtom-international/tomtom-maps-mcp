/**
 * Records both halves of the tool-surface comparison, then reports it.
 *
 * This was a `&&` chain in `package.json`, which cannot work: a scenario suite
 * exits non-zero when the agent routes a prompt wrongly, and BOTH surfaces do
 * that — the baseline runs a category pre-flight, the current one has its own
 * misroutes. That exit code is the measurement, not a build failure, so chaining
 * on it meant the run stopped at the first half and `compare` never ran.
 *
 * Tolerating every exit code instead would trade one silent failure for a worse
 * one: a phase that dies before writing anything (no API key, no `dist/`, a
 * crashed subprocess) would leave the PREVIOUS run's artefact in place and the
 * comparison would report it as current. So each phase names the file it must
 * produce, and the run stops if that file did not change. No timing heuristic —
 * either the phase rewrote its artefact or it did not.
 *
 *   pnpm evals:ab
 *   EVAL_MODEL_IDS=gpt-5.1,gpt-4.1 pnpm evals:ab
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));

interface Phase {
  /** `package.json` script to run. */
  script: string;
  /** Repo-relative artefact the phase must rewrite. */
  artefact: string;
}

const PHASES: readonly Phase[] = [
  { script: "evals:capability:baseline", artefact: "evals/capability/report.baseline.json" },
  { script: "evals:scenarios:baseline", artefact: "evals/scenarios/runs.baseline.jsonl" },
  { script: "evals:capability:current", artefact: "evals/capability/report.current.json" },
  { script: "evals:scenarios:current", artefact: "evals/scenarios/runs.current.jsonl" },
];

/** Millisecond mtime, or null when the artefact does not exist yet. */
const stampOf = (file: string): number | null => {
  const full = path.resolve(ROOT_DIR, file);
  return fs.existsSync(full) ? fs.statSync(full).mtimeMs : null;
};

for (const [index, phase] of PHASES.entries()) {
  const before = stampOf(phase.artefact);
  console.log(`\n─── ${index + 1}/${PHASES.length}  pnpm ${phase.script}\n`);

  const { status } = spawnSync("pnpm", ["run", phase.script], {
    cwd: ROOT_DIR,
    stdio: "inherit",
  });

  const after = stampOf(phase.artefact);
  if (after === null || after === before) {
    console.error(
      `\n✗ ${phase.script} exited ${status ?? "abnormally"} without rewriting ` +
        `${phase.artefact}.\n\n  The phase failed before it could record anything, so there ` +
        `is nothing to\n  compare. A stale artefact from an earlier run is still on disk; it ` +
        `is NOT\n  this run's result and the comparison would misreport it as one.\n\n  ` +
        `Common causes: no model credentials, no \`pnpm build\` (stdio needs \`dist/\`),\n  ` +
        `or no baseline worktree (\`pnpm evals:baseline:setup\`).\n`
    );
    process.exit(1);
  }

  // A non-zero exit with a rewritten artefact is the normal case: the suite ran
  // and some prompts were routed wrongly. Reported, not fatal.
  if (status !== 0) {
    console.log(`\n  ${phase.script} exited ${status} — recorded; failures are in the report.`);
  }
}

console.log("\n─── pnpm evals:compare\n");
const compare = spawnSync("pnpm", ["run", "evals:compare"], { cwd: ROOT_DIR, stdio: "inherit" });
process.exit(compare.status ?? 1);
