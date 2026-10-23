/**
 * Prepares the checkout the evals compare against.
 *
 * Creates a git worktree parked on the commit BEFORE the tool consolidation,
 * installs its dependencies and builds it, so `EVAL_SERVER_ROOT` has a real
 * `bin/tomtom-mcp.js` to spawn. A worktree rather than a branch switch because
 * both servers have to exist at once: the comparison runs this tree's harness
 * against that tree's server.
 *
 *   pnpm evals:baseline:setup                  # defaults to the pre-refactor commit
 *   EVAL_BASELINE_REF=<sha> pnpm evals:baseline:setup
 *
 * Idempotent: an existing worktree at the target path is reused and rebuilt.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));

/**
 * The commit the comparison is against: the last one before
 * `refactor!: consolidate the MCP tools toward the agent toolkit`. Overridable,
 * because "the previous implementation" is a moving target once more refactors
 * land, and pinning it in an env var beats editing this file.
 */
const REF = process.env.EVAL_BASELINE_REF?.trim() || "f530cc2^";
const WORKTREE = path.resolve(
  ROOT_DIR,
  process.env.EVAL_BASELINE_DIR?.trim() || "../tomtom-mcp-baseline"
);

const run = (command: string, args: string[], cwd: string): void => {
  console.log(`  $ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { cwd, stdio: "inherit" });
};

const resolved = execFileSync("git", ["rev-parse", "--short", REF], {
  cwd: ROOT_DIR,
  encoding: "utf-8",
}).trim();

console.log(`baseline ref  ${REF} → ${resolved}`);
console.log(`worktree      ${WORKTREE}\n`);

if (fs.existsSync(WORKTREE)) {
  console.log("worktree exists — reusing it\n");
} else {
  run("git", ["worktree", "add", "--detach", WORKTREE, resolved], ROOT_DIR);
}

// The old tree's lockfile pins its own dependency set; installing in place is
// what makes its `dist/` a faithful build of that commit rather than of this
// one's node_modules.
run("pnpm", ["install", "--frozen-lockfile"], WORKTREE);
run("pnpm", ["build"], WORKTREE);

console.log(
  [
    "",
    "baseline ready. Record it, then this tree, then compare:",
    "",
    `  EVAL_SERVER_ROOT=${path.relative(ROOT_DIR, WORKTREE)} pnpm evals:capability:baseline`,
    "  pnpm evals:capability:current",
    "  pnpm evals:compare",
    "",
    "Remove it with:",
    `  git worktree remove ${WORKTREE}`,
    "",
  ].join("\n")
);
