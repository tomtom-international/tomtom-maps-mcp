/*
 * Copyright (C) 2025 TomTom NV
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

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { tomtomTrafficSchema } from "./trafficOrbisSchema";

describe("tomtomTrafficSchema", () => {
  const schema = z.object(tomtomTrafficSchema);
  it("should parse a valid traffic input with bbox", () => {
    const input = { bbox: "-74.02,40.70,-73.96,40.80" };
    expect(schema.parse(input)).toMatchObject(input);
  });
  it("should parse with all optional fields", () => {
    const input = {
      bbox: "-74.02,40.70,-73.96,40.80",
      language: "en-US",
      categoryFilter: "0,1,2",
      t: 1720000000,
    };
    expect(schema.parse(input)).toMatchObject(input);
  });
  it("should fail if t is not a number", () => {
    expect(() => schema.parse({ t: "not-a-number" })).toThrow();
  });
});
