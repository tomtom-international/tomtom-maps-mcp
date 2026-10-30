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
const RELEASE_HEADING_PREFIX = "\n## [";
const ENTRY_REQUIRED_TITLE = /^(?:(?:feat|fix)(?:\([^)]*\))?!?|[a-z]+(?:\([^)]*\))?!):/;
const ENTRY_LINE = /^\s*- /;
const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;
const RELEASE_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function requiresEntry(title) {
  return ENTRY_REQUIRED_TITLE.test(title);
}

export function addsUnreleasedEntry(baseText, headText) {
  const baseEntries = new Set(unreleasedEntries(baseText));
  return unreleasedEntries(headText).some((entry) => !baseEntries.has(entry));
}

export function stampRelease(text, version, date) {
  if (!RELEASE_VERSION.test(version)) {
    throw new Error(`${version} is not a release version. Pass MAJOR.MINOR.PATCH, such as 1.6.15.`);
  }
  if (!RELEASE_DATE.test(date)) {
    throw new Error(`${date} is not a release date. Pass YYYY-MM-DD, such as 2026-10-30.`);
  }
  if (text.includes(releaseHeadingPrefix(version))) {
    throw new Error(`CHANGELOG.md already has a ${version} section. Release a higher version.`);
  }
  if (unreleasedEntries(text).length === 0) {
    throw new Error(
      `CHANGELOG.md has no entries under ${UNRELEASED_HEADING}. Merge the pull requests' entries before releasing ${version}.`,
    );
  }
  return text.replace(UNRELEASED_LINE, `${UNRELEASED_HEADING}\n\n## [${version}] - ${date}`);
}

export function releaseSection(text, version) {
  const start = text.indexOf(releaseHeadingPrefix(version));
  if (start === -1) {
    throw new Error(`CHANGELOG.md has no ${version} section. Stamp the release first.`);
  }
  return sectionBody(text, text.indexOf("\n", start + 1));
}

function unreleasedEntries(text) {
  const heading = UNRELEASED_LINE.exec(text);
  if (heading === null) {
    throw new Error(`CHANGELOG.md has no ${UNRELEASED_HEADING} section. Add it above the latest release.`);
  }
  return sectionBody(text, heading.index + heading[0].length)
    .split("\n")
    .filter((line) => ENTRY_LINE.test(line));
}

function releaseHeadingPrefix(version) {
  return `${RELEASE_HEADING_PREFIX}${version}] - `;
}

function sectionBody(text, bodyStart) {
  const end = text.indexOf(RELEASE_HEADING_PREFIX, bodyStart);
  return text.slice(bodyStart, end === -1 ? undefined : end).trim();
}
