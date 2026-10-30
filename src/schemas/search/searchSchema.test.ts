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
import { tomtomReverseGeocodeSearchSchema } from "./searchSchema";

describe("tomtomReverseGeocodeSearchSchema", () => {
  const schema = z.object(tomtomReverseGeocodeSearchSchema);
  it("should parse a valid reverse geocode search input", () => {
    const input = { position: [-74.006, 40.7128] };
    expect(schema.parse(input)).toMatchObject(input);
  });
  it("should fail if position is missing", () => {
    expect(() => schema.parse({})).toThrow();
  });
  it("should fail if position has wrong format", () => {
    expect(() => schema.parse({ position: "invalid" })).toThrow();
  });
});
