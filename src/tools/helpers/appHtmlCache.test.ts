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

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readAppHtml } from "./appHtmlCache";

// Exercised against a real filesystem: the cache keys off mtime and size, which
// a mocked fs would only ever report back as whatever the test already decided.
let tmpDir: string;
let appCount = 0;

/** A fresh app path, so each test is independent of the module-level cache. */
function newAppPath(): string {
  appCount += 1;
  return path.join(tmpDir, `app-${appCount}.html`);
}

/** Rewrites a bundle the way a rebuild does, guaranteeing a later mtime. */
async function rebuild(appPath: string, html: string): Promise<void> {
  const before = await fs.stat(appPath).catch(() => null);
  await fs.writeFile(appPath, html);
  if (before) {
    const after = await fs.stat(appPath);
    // Same-millisecond rewrites are possible on a coarse clock; push mtime out
    // so the test asserts the invalidation rule, not the filesystem's timer.
    if (after.mtimeMs === before.mtimeMs) {
      const bumped = new Date(before.mtimeMs + 1000);
      await fs.utimes(appPath, bumped, bumped);
    }
  }
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tomtom-app-html-cache-"));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readAppHtml", () => {
  it("should return the bundle's contents", async () => {
    const appPath = newAppPath();
    await fs.writeFile(appPath, "<html><body>App</body></html>");

    expect(await readAppHtml(appPath)).toBe("<html><body>App</body></html>");
  });

  it("should read from disk only once for repeated reads", async () => {
    const appPath = newAppPath();
    await fs.writeFile(appPath, "<html><body>App</body></html>");
    await readAppHtml(appPath);

    const readFile = vi.spyOn(fs, "readFile");
    expect(await readAppHtml(appPath)).toBe("<html><body>App</body></html>");
    expect(await readAppHtml(appPath)).toBe("<html><body>App</body></html>");

    expect(readFile).not.toHaveBeenCalled();

    // Control: proves the assertion above is the cache working and not a spy
    // that was never wired to the call in the first place.
    await rebuild(appPath, "<html><body>App rebuilt</body></html>");
    expect(await readAppHtml(appPath)).toBe("<html><body>App rebuilt</body></html>");
    expect(readFile).toHaveBeenCalledOnce();
  });

  it("should serve a rebuilt bundle without a restart", async () => {
    const appPath = newAppPath();
    await fs.writeFile(appPath, "<html><body>Before</body></html>");
    expect(await readAppHtml(appPath)).toBe("<html><body>Before</body></html>");

    await rebuild(appPath, "<html><body>After the rebuild</body></html>");

    expect(await readAppHtml(appPath)).toBe("<html><body>After the rebuild</body></html>");
  });

  it("should invalidate on a same-size rebuild, which only mtime reveals", async () => {
    const appPath = newAppPath();
    await fs.writeFile(appPath, "<html><body>aaaa</body></html>");
    expect(await readAppHtml(appPath)).toBe("<html><body>aaaa</body></html>");

    // Byte-for-byte the same length, so size alone cannot tell these apart.
    await rebuild(appPath, "<html><body>bbbb</body></html>");

    expect(await readAppHtml(appPath)).toBe("<html><body>bbbb</body></html>");
  });

  it("should cache each app separately", async () => {
    const first = newAppPath();
    const second = newAppPath();
    await fs.writeFile(first, "<html><body>First</body></html>");
    await fs.writeFile(second, "<html><body>Second</body></html>");

    expect(await readAppHtml(first)).toBe("<html><body>First</body></html>");
    expect(await readAppHtml(second)).toBe("<html><body>Second</body></html>");
    expect(await readAppHtml(first)).toBe("<html><body>First</body></html>");
  });

  it("should throw when the bundle is missing", async () => {
    await expect(readAppHtml(newAppPath())).rejects.toThrow();
  });

  it("should pick up a bundle built after a failed read", async () => {
    const appPath = newAppPath();
    // A server started before `build:apps` ran.
    await expect(readAppHtml(appPath)).rejects.toThrow();

    await fs.writeFile(appPath, "<html><body>Built later</body></html>");

    expect(await readAppHtml(appPath)).toBe("<html><body>Built later</body></html>");
  });
});
