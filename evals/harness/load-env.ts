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
 * Loads the repo `.env` into `process.env`. Import it before anything that reads the
 * environment at module load, as `harness/model.ts` does. Same approach as the agent toolkit's
 * `vitest.config.ts`, with one difference: a variable already present in the environment WINS
 * over the file. The toolkit assigns the file over `process.env`, which silently discards a
 * command-line override — `EVAL_MODEL_IDS=... pnpm evals` would run whatever `.env` says and
 * label the report with a model nobody asked for.
 */

import path from "node:path";
import { loadEnv } from "vite";

for (const [key, value] of Object.entries(
  loadEnv("", path.resolve(import.meta.dirname, "../.."), "")
)) {
  if (process.env[key] === undefined) process.env[key] = value;
}
