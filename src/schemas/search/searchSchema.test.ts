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
import {
  tomtomFuzzySearchSchema,
  tomtomGeocodeSearchSchema,
  tomtomPOISearchSchema,
  tomtomReverseGeocodeSearchSchema,
} from "./searchSchema";

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

describe("poiCategories", () => {
  it("takes at most 10 categories, as the Search API does", () => {
    const schema = z.object(tomtomPOISearchSchema);
    const categories = (n: number) => Array.from({ length: n }, () => "RESTAURANT");
    expect(
      schema.parse({ query: "food", poiCategories: categories(10) }).poiCategories
    ).toHaveLength(10);
    expect(() => schema.parse({ query: "food", poiCategories: categories(11) })).toThrow();
  });
});
