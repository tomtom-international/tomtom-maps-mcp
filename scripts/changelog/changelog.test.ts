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
import {
  addsUnreleasedEntry,
  releaseSection,
  requiresEntry,
  stampRelease,
} from "./changelog.mjs";

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

  it("rejects a changelog without an Unreleased section", () => {
    const head = changelog("- New fix.").replace("## [Unreleased]", "## Unreleased");

    expect(() => addsUnreleasedEntry(changelog(""), head)).toThrow(
      "CHANGELOG.md has no ## [Unreleased] section. Add it above the latest release.",
    );
  });
});

describe("stampRelease", () => {
  it("dates the Unreleased entries as the release and opens an empty Unreleased", () => {
    const stamped = stampRelease(changelog("### Fixed\n- New fix."), "1.6.15", "2026-10-30");

    expect(stamped).toBe(
      [
        "# Changelog",
        "",
        "## [Unreleased]",
        "",
        "## [1.6.15] - 2026-10-30",
        "",
        "### Fixed",
        "- New fix.",
        "",
        "## [1.6.14] - 2026-10-27",
        "",
        "### Changed",
        "- Older entry.",
        "",
      ].join("\n"),
    );
  });

  it("stamps the repository's own changelog", () => {
    const stamped = stampRelease(repositoryChangelog, "9.9.9", "2026-10-30");

    expect(releaseSection(stamped, "9.9.9")).toBe(
      repositoryChangelog.split("## [Unreleased]\n")[1].split("\n## [")[0].trim(),
    );
  });

  it("refuses a release without Unreleased entries", () => {
    expect(() => stampRelease(changelog("### Fixed"), "1.6.15", "2026-10-30")).toThrow(
      "CHANGELOG.md has no entries under ## [Unreleased]. Merge the pull requests' entries before releasing 1.6.15.",
    );
  });

  it("refuses a version the changelog already has", () => {
    expect(() => stampRelease(changelog("- New fix."), "1.6.14", "2026-10-30")).toThrow(
      "CHANGELOG.md already has a 1.6.14 section. Release a higher version.",
    );
  });

  it.each(["v1.6.15", "1.6", "1.6.15-rc.1"])("rejects the version %s", (version) => {
    expect(() => stampRelease(changelog("- New fix."), version, "2026-10-30")).toThrow(
      `${version} is not a release version. Pass MAJOR.MINOR.PATCH, such as 1.6.15.`,
    );
  });

  it.each(["2026-10-3", "30-10-2026"])("rejects the date %s", (date) => {
    expect(() => stampRelease(changelog("- New fix."), "1.6.15", date)).toThrow(
      `${date} is not a release date. Pass YYYY-MM-DD, such as 2026-10-30.`,
    );
  });
});

describe("releaseSection", () => {
  it("returns a released version's entries", () => {
    const section = releaseSection(repositoryChangelog, "1.6.14");

    expect(section).toMatch(/^### Changed\n- Every data tool keeps its `_meta` in one place/);
    expect(section).not.toContain("## [");
  });

  it("returns the oldest version's entries up to the end of the file", () => {
    const text = "## [Unreleased]\n\n## [0.1.0] - 2025-01-01\n\n### Added\n- First tool.\n";

    expect(releaseSection(text, "0.1.0")).toBe("### Added\n- First tool.");
  });

  it("rejects a version the changelog lacks", () => {
    expect(() => releaseSection(repositoryChangelog, "0.0.1")).toThrow(
      "CHANGELOG.md has no 0.0.1 section. Stamp the release first.",
    );
  });
});
