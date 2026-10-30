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
import { describe, expect, it } from "vitest";
import { addsUnreleasedEntry, requiresEntry } from "./changelog.mjs";

const repositoryChangelog = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");

function changelog(unreleased: string): string {
  return [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    unreleased,
    "",
    "## [1.6.14] - 2026-10-27",
    "",
    "### Changed",
    "- Older entry.",
    "",
  ].join("\n");
}

describe("requiresEntry", () => {
  it.each([
    "feat: add a tool",
    "fix: keep a tool result's _meta in one field",
    "fix(errors): name a key without the API among its products as a 403 cause",
    "refactor(traffic)!: call the Traffic API through the maps-sdk",
    "chore!: maps-sdk 1.0.0-rc.1",
  ])("requires an entry for %s", (title) => {
    expect(requiresEntry(title)).toBe(true);
  });

  it.each([
    "test: cover MCP Apps",
    "ci: bump vite from 8.3.3 to 8.3.4",
    "docs(changelog): give 1.6.11 its own section",
    "chore: depend on maps-sdk 1.0.0-rc.2",
    "refactor(http): carry the client's own name instead of a family",
    "feature: not a conventional type",
  ])("leaves %s to the writer", (title) => {
    expect(requiresEntry(title)).toBe(false);
  });
});

describe("addsUnreleasedEntry", () => {
  it("counts an entry added under Unreleased", () => {
    const base = changelog("### Fixed\n- Old fix.");
    const head = changelog("### Fixed\n- Old fix.\n- New fix.");

    expect(addsUnreleasedEntry(base, head)).toBe(true);
  });

  it("counts an existing Unreleased entry reworded", () => {
    const base = changelog("### Fixed\n- Old fix.");
    const head = changelog("### Fixed\n- Old fix, reworded.");

    expect(addsUnreleasedEntry(base, head)).toBe(true);
  });

  it("counts a sub-bullet added under Unreleased", () => {
    const base = changelog("### Removed\n- Inputs:");
    const head = changelog("### Removed\n- Inputs:\n  - `limit`.");

    expect(addsUnreleasedEntry(base, head)).toBe(true);
  });

  it("ignores an edit to a released section", () => {
    const base = changelog("### Fixed\n- Old fix.");
    const head = base.replace("- Older entry.", "- Older entry, reworded.");

    expect(addsUnreleasedEntry(base, head)).toBe(false);
  });

  it("ignores a heading added under Unreleased without an entry", () => {
    const base = changelog("### Fixed\n- Old fix.");
    const head = changelog("### Added\n\n### Fixed\n- Old fix.");

    expect(addsUnreleasedEntry(base, head)).toBe(false);
  });

  it("ignores an entry removed from Unreleased", () => {
    const base = changelog("### Fixed\n- Old fix.\n- Other fix.");
    const head = changelog("### Fixed\n- Old fix.");

    expect(addsUnreleasedEntry(base, head)).toBe(false);
  });

  it("finds Unreleased on the first line", () => {
    const head = "## [Unreleased]\n\n- New fix.\n";

    expect(addsUnreleasedEntry("## [Unreleased]\n", head)).toBe(true);
  });

  it("reads the repository's own changelog", () => {
    const head = repositoryChangelog.replace("## [Unreleased]\n", "## [Unreleased]\n\n### Fixed\n- New fix.\n");

    expect(addsUnreleasedEntry(repositoryChangelog, head)).toBe(true);
  });

  it("rejects a changelog without an Unreleased section", () => {
    const head = changelog("- New fix.").replace("## [Unreleased]", "## Unreleased");

    expect(() => addsUnreleasedEntry(changelog(""), head)).toThrow(
      "CHANGELOG.md has no ## [Unreleased] section. Add it above the latest release.",
    );
  });
});
