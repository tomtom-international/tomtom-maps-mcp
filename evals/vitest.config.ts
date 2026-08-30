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
 * Separate config from the root `vitest.config.ts`, which only includes
 * `src/**\/*.test.ts`. The evals are model-in-the-loop: slow, credential-gated,
 * and they cost money, so they never run as part of `pnpm test`.
 */

import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Load the repo `.env` into `process.env` BEFORE the suites import
// `harness/model.ts`, which resolves the Azure config at module load. Same
// approach as the agent toolkit's `vitest.config.ts`, with one difference: a
// variable already present in the environment WINS over the file. The toolkit
// assigns the file over `process.env`, which silently discards a command-line
// override — `EVAL_MODEL_IDS=... pnpm evals:ab` would run whatever `.env` says
// and label the report with a model nobody asked for.
for (const [key, value] of Object.entries(
  loadEnv("", path.resolve(import.meta.dirname, ".."), "")
)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["evals/**/*.test.ts"],
    // Reaps the shared MCP subprocess each file may have opened.
    setupFiles: [path.resolve(import.meta.dirname, "harness/setup.ts")],
    // Truncates the scenario log once, before any worker appends to it.
    globalSetup: [path.resolve(import.meta.dirname, "harness/global-setup.ts")],
    // Model calls dominate the wall clock; per-suite timeouts are set inline.
    testTimeout: 300_000,
    hookTimeout: 60_000,
    // Serial. Concurrent model calls trip Azure rate limits, and the capability
    // benchmark shares one process-wide viz cache.
    fileParallelism: false,
    maxConcurrency: 1,
  },
});
