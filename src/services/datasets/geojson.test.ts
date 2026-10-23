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
import { normalizeToFeatureCollection } from "./geojson";

const point = { type: "Point", coordinates: [4.9, 52.37] };
const feature = { type: "Feature", geometry: point, properties: { name: "Dam" } };

describe("normalizeToFeatureCollection", () => {
  it("keeps a FeatureCollection as it is", () => {
    const collection = { type: "FeatureCollection", features: [feature] };
    expect(normalizeToFeatureCollection(collection)).toBe(collection);
  });

  it("wraps a bare array of Features", () => {
    expect(normalizeToFeatureCollection([feature, feature])).toEqual({
      type: "FeatureCollection",
      features: [feature, feature],
    });
  });

  it("wraps an empty array as an empty collection", () => {
    expect(normalizeToFeatureCollection([])).toEqual({ type: "FeatureCollection", features: [] });
  });

  it.each([
    ["a geometry", point],
    ["null", null],
    ["a string", "Feature"],
  ])("rejects an array holding %s, naming the element", (_name, element) => {
    expect(() => normalizeToFeatureCollection([feature, element])).toThrow(
      expect.objectContaining({
        message: expect.stringContaining("an array element is not a Feature"),
        data: { index: 1 },
      })
    );
  });

  it("wraps a single Feature", () => {
    expect(normalizeToFeatureCollection(feature)).toEqual({
      type: "FeatureCollection",
      features: [feature],
    });
  });

  it("wraps a bare geometry in a Feature with empty properties", () => {
    expect(normalizeToFeatureCollection(point)).toEqual({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: point, properties: {} }],
    });
  });

  it("rejects a FeatureCollection without a features array", () => {
    expect(() => normalizeToFeatureCollection({ type: "FeatureCollection" })).toThrow(
      "missing its 'features' array"
    );
  });

  it.each([
    ["null", null],
    ["a number", 42],
  ])("rejects %s as not an object", (_name, value) => {
    expect(() => normalizeToFeatureCollection(value)).toThrow("expected an object");
  });

  it("rejects an object of no GeoJSON type, naming the type", () => {
    expect(() => normalizeToFeatureCollection({ type: "Topology" })).toThrow(
      expect.objectContaining({ data: { type: "Topology" } })
    );
  });
});
