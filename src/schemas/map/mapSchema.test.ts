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
import { tomtomMapSchema } from "./mapSchema";

describe("tomtomMapSchema", () => {
  it("should parse a valid map input with center", () => {
    const input = {
      center: { lat: 37.7749, lon: -122.4194 },
      zoom: 12,
      width: 800,
      height: 600,
      style: "main",
    };
    const schema = z.object(tomtomMapSchema);
    expect(schema.parse(input)).toMatchObject(input);
  });

  it("should parse a valid map input with bbox", () => {
    const input = {
      center: { lat: 0, lon: 0 }, // required by schema
      bbox: [-122.42, 37.77, -122.4, 37.79],
      width: 400,
      height: 400,
    };
    const schema = z.object(tomtomMapSchema);
    expect(schema.parse(input)).toMatchObject(input);
  });

  it("should fail if center is missing", () => {
    const schema = z.object(tomtomMapSchema);
    expect(() => schema.parse({ width: 400, height: 400 })).toThrow();
  });

  it("should fail if bbox is not an array of 4 numbers", () => {
    const schema = z.object(tomtomMapSchema);
    expect(() => schema.parse({ center: { lat: 0, lon: 0 }, bbox: [1, 2, 3] })).toThrow();
  });

  it("should fail if style is invalid", () => {
    const schema = z.object(tomtomMapSchema);
    expect(() => schema.parse({ center: { lat: 0, lon: 0 }, style: "invalid" })).toThrow();
  });
});
