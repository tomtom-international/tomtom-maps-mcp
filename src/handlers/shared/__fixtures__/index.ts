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
 * Test helpers for the compact-response fixtures in this folder.
 *
 * The JSON files are live responses (response_detail "full", captured for #285)
 * cut down to a few results: orbis-* are the maps-sdk's parsed shapes, genesis-*
 * the TomTom Maps REST shapes. The reachable-range apiKey is a placeholder.
 */

import { readFileSync } from "node:fs";
import { expect } from "vitest";

// biome-ignore lint/suspicious/noExplicitAny: fixtures are untyped JSON
export type Json = any;

export function loadFixture(name: string): Json {
  return JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), "utf8"));
}

/** Children at one path segment of each value; a `[]` suffix spreads the array. */
function step(values: unknown[], segment: string): unknown[] {
  const each = segment.endsWith("[]");
  const key = each ? segment.slice(0, -2) : segment;
  const children = values
    .filter((v): v is Record<string, unknown> => v !== null && typeof v === "object")
    .map((v) => v[key])
    .filter((child) => child !== undefined);
  return each ? children.filter(Array.isArray).flat() : children;
}

/**
 * Values at a dot path, where a `[]` suffix means "every element",
 * e.g. "features[].properties.poi.brands".
 */
export function valuesAt(value: unknown, path: string): unknown[] {
  return path.split(".").reduce<unknown[]>(step, [value]);
}

/**
 * Each path must exist in the input (so a trim that no longer matches the
 * real shape fails here) and be gone from the compact output.
 */
export function expectDropped(input: unknown, output: unknown, paths: string[]): void {
  for (const path of paths) {
    expect(valuesAt(input, path).length, `fixture should contain ${path}`).toBeGreaterThan(0);
    expect(valuesAt(output, path), `compact should drop ${path}`).toEqual([]);
  }
}

/** Each path must survive in the compact output. */
export function expectKept(output: unknown, paths: string[]): void {
  for (const path of paths) {
    expect(valuesAt(output, path).length, `compact should keep ${path}`).toBeGreaterThan(0);
  }
}
