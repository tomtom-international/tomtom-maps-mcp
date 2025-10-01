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
import {
  tomtomFuzzySearchSchema,
  tomtomPOISearchSchema,
  tomtomNearbySearchSchema,
  tomtomGeocodeSearchSchema,
  tomtomReverseGeocodeSearchSchema,
} from "./searchOrbisSchema";

describe("tomtomFuzzySearchSchema", () => {
  it("should parse a valid fuzzy search input", () => {
    const input = {
      query: "restaurants near Central Park",
      typeahead: true,
      radius: 1000,
    };
    const schema = z.object(tomtomFuzzySearchSchema);
    expect(schema.parse(input)).toMatchObject(input);
  });

  it("should fail if query is missing", () => {
    const schema = z.object(tomtomFuzzySearchSchema);
    expect(() => schema.parse({})).toThrow();
  });

  it("should fail if radius is not a number", () => {
    const schema = z.object(tomtomFuzzySearchSchema);
    expect(() => schema.parse({ query: "test", radius: "not-a-number" })).toThrow();
  });
});

describe("tomtomPOISearchSchema", () => {
  it("should parse a valid POI search input", () => {
    const input = {
      query: "restaurants",
      radius: 5000,
    };
    const schema = z.object(tomtomPOISearchSchema);
    expect(schema.parse(input)).toMatchObject(input);
  });

  it("should fail if query is missing", () => {
    const schema = z.object(tomtomPOISearchSchema);
    expect(() => schema.parse({})).toThrow();
  });

  it("should fail if radius is not a number", () => {
    const schema = z.object(tomtomPOISearchSchema);
    expect(() => schema.parse({ query: "test", radius: "not-a-number" })).toThrow();
  });
});

describe("tomtomNearbySearchSchema", () => {
  const schema = z.object(tomtomNearbySearchSchema);
  it("should parse a valid nearby search input", () => {
    const input = { lat: 40.7128, lon: -74.006, radius: 1000 };
    expect(schema.parse(input)).toMatchObject(input);
  });
  it("should fail if lat is missing", () => {
    expect(() => schema.parse({ lon: -74.006 })).toThrow();
  });
  it("should fail if lon is missing", () => {
    expect(() => schema.parse({ lat: 40.7128 })).toThrow();
  });
  it("should fail if radius is not a number", () => {
    expect(() => schema.parse({ lat: 40.7128, lon: -74.006, radius: "foo" })).toThrow();
  });
});

describe("tomtomGeocodeSearchSchema", () => {
  const schema = z.object(tomtomGeocodeSearchSchema);
  it("should parse a valid geocode search input", () => {
    const input = { query: "1600 Pennsylvania Ave, Washington DC" };
    expect(schema.parse(input)).toMatchObject(input);
  });
  it("should fail if query is missing", () => {
    expect(() => schema.parse({})).toThrow();
  });
});

describe("tomtomReverseGeocodeSearchSchema", () => {
  const schema = z.object(tomtomReverseGeocodeSearchSchema);
  it("should parse a valid reverse geocode search input", () => {
    const input = { lat: 40.7128, lon: -74.006 };
    expect(schema.parse(input)).toMatchObject(input);
  });
  it("should fail if lat is missing", () => {
    expect(() => schema.parse({ lon: -74.006 })).toThrow();
  });
  it("should fail if lon is missing", () => {
    expect(() => schema.parse({ lat: 40.7128 })).toThrow();
  });
});
