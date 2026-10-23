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
 * Prepares the checkout the evals compare against.
 *
 * Creates a git worktree parked on the commit this branch forked from `main`,
 * installs its dependencies and builds it, so `EVAL_SERVER_ROOT` has a real
 * `bin/tomtom-mcp.js` to spawn. A worktree rather than a branch switch because
 * both servers have to exist at once: the comparison runs this tree's harness
 * against that tree's server.
 *
 *   pnpm evals:baseline:setup                  # defaults to the merge-base with origin/main
 *   EVAL_BASELINE_REF=<sha> pnpm evals:baseline:setup
 *
 * Idempotent: an existing worktree at the target path is reused and rebuilt.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));

const git = (args: string[]): string =>
  execFileSync("git", args, { cwd: ROOT_DIR, encoding: "utf-8" }).trim();

/**
 * The commit the comparison is against: where this branch left `origin/main`,
 * which is the released surface the branch replaces. Derived rather than pinned
 * so it resolves on any clone that has fetched `main`. Overridable, because "the
 * previous implementation" moves as more refactors land.
 */
const REF = process.env.EVAL_BASELINE_REF?.trim() || git(["merge-base", "HEAD", "origin/main"]);
const WORKTREE = path.resolve(
  ROOT_DIR,
  process.env.EVAL_BASELINE_DIR?.trim() || "../tomtom-mcp-baseline"
);

const run = (command: string, args: string[], cwd: string): void => {
  console.log(`  $ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { cwd, stdio: "inherit" });
};

const resolved = git(["rev-parse", "--short", REF]);

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
