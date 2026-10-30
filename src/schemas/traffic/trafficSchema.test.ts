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
import { tomtomGetTrafficSchema } from "./trafficSchema";

describe("tomtomGetTrafficSchema", () => {
  const schema = z.object(tomtomGetTrafficSchema);
  const where = { mode: "within", boundingBox: [4.8, 52.3, 5.0, 52.4] };

  it("should parse a lookup with all optional fields", () => {
    const input = {
      where,
      language: "en-GB",
      categoryFilter: ["accident", "road-closed"],
      timeValidityFilter: ["present", "future"],
      maxResults: 20,
    };
    expect(schema.parse(input)).toMatchObject(input);
  });

  it.each([
    ["a category code", { categoryFilter: ["8"] }],
    ["a response-only category", { categoryFilter: ["narrow-lanes"] }],
    ["a comma-separated time filter", { timeValidityFilter: "present,future" }],
    ["a retired bbox in place of where", { where: undefined, bbox: [4.8, 52.3, 5.0, 52.4] }],
  ])("should reject %s", (_name, input) => {
    expect(() => schema.parse({ where, ...input })).toThrow();
  });
});
