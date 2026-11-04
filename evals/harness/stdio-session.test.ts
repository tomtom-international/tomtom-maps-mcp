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
 */

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sourcesNewerThan } from "./stdio-session";

describe("sourcesNewerThan", () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("names the nested sources changed after the bundle, and nothing else", () => {
    root = mkdtempSync(join(tmpdir(), "eval-freshness-"));
    mkdirSync(join(root, "src", "tools"), { recursive: true });
    const old = new Date("2026-01-01T00:00:00Z");
    for (const file of ["src/index.ts", "src/tools/old.ts", "src/tools/notes.md"]) {
      writeFileSync(join(root, file), "");
      utimesSync(join(root, file), old, old);
    }
    writeFileSync(join(root, "src", "tools", "new.ts"), "");

    expect(sourcesNewerThan(root, old.getTime())).toEqual([join("src", "tools", "new.ts")]);
  });

  it("throws on a checkout without src/, rather than passing it as fresh", () => {
    const checkout = mkdtempSync(join(tmpdir(), "eval-freshness-"));
    root = checkout;
    expect(() => sourcesNewerThan(checkout, 0)).toThrow(/ENOENT/);
  });
});
