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

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const released = "## [Unreleased]\n\n## [1.6.14] - 2026-10-27\n\n### Changed\n- Older entry.\n";
const withEntry = released.replace("## [Unreleased]\n", "## [Unreleased]\n\n### Fixed\n- New fix.\n");

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "check-entry-"));
});

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

function changelogFile(name: string, text: string): string {
  const path = join(directory, name);
  writeFileSync(path, text);
  return path;
}

async function checkEntry(...args: string[]) {
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  vi.spyOn(process, "argv", "get").mockReturnValue([process.execPath, "check-entry.mjs", ...args]);
  vi.resetModules();
  await import("./check-entry.mjs");
  return { status: process.exitCode ?? 0, stderr: stderr.mock.calls.join("") };
}

it("passes a fix that adds an entry", async () => {
  const result = await checkEntry("fix: a bug", changelogFile("base.md", released), changelogFile("head.md", withEntry));

  expect(result.status).toBe(0);
});

it("passes a test pull request without an entry", async () => {
  const base = changelogFile("base.md", released);

  expect((await checkEntry("test: cover a tool", base, base)).status).toBe(0);
});

it("fails a fix without an entry, saying how to pass", async () => {
  const base = changelogFile("base.md", released);
  const result = await checkEntry("fix: a bug", base, base);

  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    "::error::Add an entry under ## [Unreleased] in CHANGELOG.md for this change, or label the pull request no-changelog if users cannot see it.\n",
  );
});

it("fails a changelog without an Unreleased section", async () => {
  const base = changelogFile("base.md", released);
  const result = await checkEntry("fix: a bug", base, changelogFile("head.md", "## [1.6.14] - 2026-10-27\n"));

  expect(result.status).toBe(1);
  expect(result.stderr).toBe("::error::CHANGELOG.md has no ## [Unreleased] section. Add it above the latest release.\n");
});

it("rejects missing arguments, naming them", async () => {
  const result = await checkEntry("fix: a bug");

  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    "::error::Pass the pull request title, the base CHANGELOG.md and the head CHANGELOG.md.\n",
  );
});
