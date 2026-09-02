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
 * Run-level setup: clears the scenario log before anything appends to it.
 *
 * Scenario outcomes are written as JSON lines from inside the worker processes,
 * because a vitest worker cannot hand module state back to the main process. An
 * append-only log is the simplest sink that needs no coordination — but it has
 * to start empty, or a five-scenario run gets compared against yesterday's
 * fifteen. This is the one hook that runs once, before any worker starts.
 *
 * It clears only when the run will actually produce scenario records. A
 * capability-only run (`vitest run … evals/capability`) shares this config, and
 * wiping the scenario half of a comparison as a side effect of recording the
 * capability half would be a genuinely confusing way to lose data — the file
 * would simply be empty at compare time with nothing to explain it.
 */

import { rmSync } from "node:fs";
import { SCENARIO_LOG_PATH } from "./scenario-log";

/**
 * True when this invocation can reach the scenario suite: either no path filter
 * was given (so everything runs), or one of the filters names the scenarios.
 * Our own npm scripts always pass an explicit directory, which is what makes
 * this readable off `argv` rather than guessed.
 */
const willRunScenarios = (argv: readonly string[] = process.argv.slice(2)): boolean => {
  const filters = argv.filter(
    (arg, index) =>
      !arg.startsWith("-") &&
      arg.includes("evals/") &&
      // `--config evals/vitest.config.ts` looks exactly like a path filter and
      // is not one; without this, a full run would think it was scoped to a
      // file that matches no tests and skip the clear.
      !arg.includes("vitest.config") &&
      !["--config", "-c"].includes(argv[index - 1] ?? "")
  );
  return filters.length === 0 || filters.some((filter) => filter.includes("scenario"));
};

export default function setup(): void {
  if (willRunScenarios()) rmSync(SCENARIO_LOG_PATH, { force: true });
}

export { willRunScenarios };
