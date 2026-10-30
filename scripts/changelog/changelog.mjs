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

const UNRELEASED_HEADING = "## [Unreleased]";
const UNRELEASED_LINE = /^## \[Unreleased\]$/m;
const RELEASE_HEADING = "\n## [";
const ENTRY_REQUIRED_TITLE = /^(?:(?:feat|fix)(?:\([^)]*\))?!?|[a-z]+(?:\([^)]*\))?!):/;
const ENTRY_LINE = /^\s*- /;

export function requiresEntry(title) {
  return ENTRY_REQUIRED_TITLE.test(title);
}

export function addsUnreleasedEntry(baseText, headText) {
  const baseEntries = new Set(unreleasedEntries(baseText));
  return unreleasedEntries(headText).some((entry) => !baseEntries.has(entry));
}

function unreleasedEntries(text) {
  const heading = UNRELEASED_LINE.exec(text);
  if (heading === null) {
    throw new Error(`CHANGELOG.md has no ${UNRELEASED_HEADING} section. Add it above the latest release.`);
  }
  const start = heading.index + heading[0].length;
  const end = text.indexOf(RELEASE_HEADING, start);
  return text
    .slice(start, end === -1 ? undefined : end)
    .split("\n")
    .filter((line) => ENTRY_LINE.test(line));
}
