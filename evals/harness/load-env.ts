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
 * Loads the repo `.env` into `process.env`: import it before anything that reads the environment
 * at module load, as `harness/model.ts` does. Unlike the agent toolkit's loader, a variable
 * already set wins over the file, so `EVAL_MODEL_IDS=... pnpm evals` runs the model asked for.
 */

import path from "node:path";
import { loadEnv } from "vite";

for (const [key, value] of Object.entries(
  loadEnv("", path.resolve(import.meta.dirname, "../.."), "")
)) {
  if (process.env[key] === undefined) process.env[key] = value;
}
