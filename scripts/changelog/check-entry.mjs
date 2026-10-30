/*
 * Copyright (C) 2026 TomTom Navigation B.V.
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
 */

import { readFileSync } from "node:fs";
import { addsUnreleasedEntry, requiresEntry } from "./changelog.mjs";

const [title, basePath, headPath] = process.argv.slice(2);

try {
  if (headPath === undefined) {
    throw new Error("Pass the pull request title, the base CHANGELOG.md and the head CHANGELOG.md.");
  }
  if (requiresEntry(title) && !addsUnreleasedEntry(readFileSync(basePath, "utf8"), readFileSync(headPath, "utf8"))) {
    throw new Error(
      "Add an entry under ## [Unreleased] in CHANGELOG.md for this change, or label the pull request no-changelog if users cannot see it.",
    );
  }
} catch (error) {
  // GitHub Actions turns a line starting with ::error:: into an annotation on the run.
  process.stderr.write(`::error::${error.message}\n`);
  process.exitCode = 1;
}
