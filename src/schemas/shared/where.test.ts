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

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { modeBranch, modeUnion, whereSchemaFor } from "./where";

describe("whereSchemaFor", () => {
  const whereSchema = whereSchemaFor(() => ["query", "where", "limit"]);
  const messagesOf = (where: unknown): string[] =>
    whereSchema.safeParse(where).error?.issues.map((issue) => issue.message) ?? [];

  it("names every mode and its inputs when `mode` is missing", () => {
    expect(messagesOf({ queries: ["Amsterdam"] })).toEqual([
      '`mode` must be one of "within" (queries, areas, boundingBox, geometries), ' +
        '"nearby" (position, query, radiusMeters), "global".',
    ]);
  });

  it("rejects an input the chosen mode does not take, rather than dropping it", () => {
    expect(messagesOf({ mode: "global", queries: ["Paris"] })).toEqual([
      'Mode "global" does not take queries; it takes nothing besides mode.',
    ]);
    expect(messagesOf({ mode: "within", queries: ["Paris"], radiusMeters: 500 })).toEqual([
      'Mode "within" does not take radiusMeters; it takes queries, areas, boundingBox, geometries.',
    ]);
  });

  it("sends one of the tool's own inputs beside `where`", () => {
    expect(messagesOf({ mode: "within", queries: ["Paris"], limit: 10 })).toEqual([
      'Mode "within" does not take limit; it takes queries, areas, boundingBox, geometries. ' +
        "limit goes beside `where`, not in it.",
    ]);
  });

  it("sends no input beside `where` that the tool does not take", () => {
    expect(messagesOf({ mode: "nearby", query: "Dam Square", maxResults: 5 })).toEqual([
      'Mode "nearby" does not take maxResults; it takes position, query, radiusMeters.',
    ]);
  });

  it("reports the matched mode's own issue", () => {
    const { error } = whereSchema.safeParse({ mode: "nearby", query: "Dam", radiusMeters: -1 });
    expect(error?.issues).toMatchObject([{ code: "too_small", path: ["radiusMeters"] }]);
  });

  it("names a missing input of the matched mode, not the list of modes", () => {
    const required = modeUnion(
      [modeBranch("global", {}), modeBranch("sorted", { sortBy: z.enum(["first", "second"]) })],
      () => []
    );
    const [issue] = required.safeParse({ mode: "sorted" }).error?.issues ?? [];
    expect(issue.message).toMatch(/^sortBy: .*"first"\|"second"/);
  });
});
