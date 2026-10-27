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

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = __dirname;

const MODULES_ALLOWED_TO_READ_THE_KEY: Record<string, string> = {
  "services/base/tomtomClient.ts": "defines the key accessors and tomtomCallParams()",
  "createServer.ts": "checks the key at startup and calls nothing",
  "services/map/dynamicMapService.ts": "checks the key before planning; its routes call getRoute",
  "tools/appTools.ts":
    "hands the key to the MCP Apps, which pair it with get-app-config's user agent",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [relative(SRC, path)]
      : [];
  });
}

const readSource = (path: string) => readFileSync(join(SRC, path), "utf8");

describe("the TomTom API key reaches TomTom only through tomtomCallParams()", () => {
  it.each(sourceFiles(join(SRC, "services")).filter((path) => !path.startsWith("services/base/")))(
    "%s sets no apiKey of its own",
    (path) => {
      expect(readSource(path)).not.toMatch(/\bapiKey\b/);
    }
  );

  it("lets only the listed modules read the key directly", () => {
    const modulesReadingTheKey = sourceFiles(SRC).filter((path) =>
      /\b(requireApiKey|getEffectiveApiKey)\b/.test(readSource(path))
    );

    expect(modulesReadingTheKey.sort()).toEqual(
      Object.keys(MODULES_ALLOWED_TO_READ_THE_KEY).sort()
    );
  });
});
