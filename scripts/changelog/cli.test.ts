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

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const released = "## [Unreleased]\n\n## [1.6.14] - 2026-10-27\n\n### Changed\n- Older entry.\n";
const withEntry = released.replace("## [Unreleased]\n", "## [Unreleased]\n\n### Fixed\n- New fix.\n");

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "changelog-cli-"));
});

function changelogFile(name: string, text: string): string {
  const path = join(directory, name);
  writeFileSync(path, text);
  return path;
}

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

async function runCli(...args: string[]) {
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  vi.spyOn(process, "argv", "get").mockReturnValue([process.execPath, "cli.mjs", ...args]);
  vi.resetModules();
  await import("./cli.mjs");
  return {
    status: process.exitCode ?? 0,
    stdout: stdout.mock.calls.join(""),
    stderr: stderr.mock.calls.join(""),
  };
}

describe("check-pr", () => {
  it("passes a fix that adds an entry", async () => {
    const result = await runCli("check-pr", "fix: a bug", changelogFile("base.md", released), changelogFile("head.md", withEntry));

    expect(result.status).toBe(0);
  });

  it("passes a test pull request without an entry", async () => {
    const base = changelogFile("base.md", released);

    expect((await runCli("check-pr", "test: cover a tool", base, base)).status).toBe(0);
  });

  it("fails a fix without an entry, naming the fix", async () => {
    const base = changelogFile("base.md", released);
    const result = await runCli("check-pr", "fix: a bug", base, base);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "::error::Add an entry under ## [Unreleased] in CHANGELOG.md for this change, or label the pull request no-changelog if users cannot see it.\n",
    );
  });
});

describe("stamp", () => {
  it("rewrites the changelog with the release section", async () => {
    const path = changelogFile("CHANGELOG.md", withEntry);

    expect((await runCli("stamp", "1.6.15", "2026-10-30", path)).status).toBe(0);
    expect(readFileSync(path, "utf8")).toContain("## [Unreleased]\n\n## [1.6.15] - 2026-10-30\n\n### Fixed\n- New fix.\n");
  });

  it("fails without Unreleased entries and leaves the file alone", async () => {
    const path = changelogFile("CHANGELOG.md", released);
    const result = await runCli("stamp", "1.6.15", "2026-10-30", path);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("::error::CHANGELOG.md has no entries under ## [Unreleased].");
    expect(readFileSync(path, "utf8")).toBe(released);
  });
});

describe("notes", () => {
  it("prints a release's section", async () => {
    const result = await runCli("notes", "1.6.14", changelogFile("CHANGELOG.md", released));

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("### Changed\n- Older entry.\n");
  });
});

it("rejects an unknown command, naming the commands", async () => {
  const result = await runCli("publish");

  expect(result.status).toBe(1);
  expect(result.stderr).toBe("::error::publish is not a command. Use check-pr, stamp or notes.\n");
});
