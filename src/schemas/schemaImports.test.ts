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
 *
 * Keeps `src/schemas` a leaf: a tool's input schema is zod and its descriptions,
 * so importing it must not pull in the resolvers, the services or the TomTom
 * client behind them.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SCHEMAS = __dirname;
const SOURCE = join(SCHEMAS, "..");

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts"))
    .map((path) => join(dir, path));

describe("src/schemas imports", () => {
  it("imports nothing from src/tools or src/services", () => {
    const outward = sourceFiles(SCHEMAS).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/from "(\.[^"]+)"/g)]
        .map(([, path]) => relative(SOURCE, join(file, "..", path)))
        .filter((target) => target.startsWith("tools") || target.startsWith("services"))
        .map((target) => `${relative(SOURCE, file)} -> ${target}`)
    );
    expect(outward).toEqual([]);
  });
});
