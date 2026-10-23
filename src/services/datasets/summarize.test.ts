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
import { summarize } from "./summarize";

const point = (lng: number, lat: number, properties: Record<string, unknown>) => ({
  type: "Feature" as const,
  geometry: { type: "Point", coordinates: [lng, lat] },
  properties,
});

const fc = (...features: unknown[]) => ({ type: "FeatureCollection", features });

describe("summarize", () => {
  it("counts features exactly and reports the geometry types", () => {
    const s = summarize(
      fc(point(4.9, 52.3, {}), {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
        properties: {},
      }),
      "places"
    );
    expect(s.kind).toBe("places");
    expect(s.count).toBe(2);
    expect(s.geometryTypes).toEqual(["LineString", "Point"]);
  });

  it("computes a bbox over every coordinate, at any nesting depth", () => {
    const s = summarize(
      fc(point(4.0, 52.0, {}), {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [3.0, 51.0],
              [6.0, 53.0],
              [3.0, 51.0],
            ],
          ],
        },
        properties: {},
      })
    );
    expect(s.bbox).toEqual([3.0, 51.0, 6.0, 53.0]);
  });

  it("returns a null bbox when nothing has coordinates", () => {
    expect(summarize(fc({ type: "Feature", properties: {} })).bbox).toBeNull();
  });

  // Regression guard: an early version returned after the first property.
  it("profiles EVERY property, not just the first", () => {
    const s = summarize(fc(point(4.9, 52.3, { a: 1, b: "x", c: true })));
    expect(Object.keys(s.properties).sort()).toEqual(["a", "b", "c"]);
  });

  it("reports presence separately from count", () => {
    const s = summarize(
      fc(point(0, 0, { name: "a" }), point(1, 1, {}), point(2, 2, { name: "c" }))
    );
    expect(s.count).toBe(3);
    expect(s.properties.name.present).toBe(2);
  });

  it("records a union type when a path holds more than one type", () => {
    const s = summarize(fc(point(0, 0, { delay: 60 }), point(1, 1, { delay: null })));
    expect(s.properties.delay.type).toBe("null|number");
  });

  it("inlines the vocabulary of a low-cardinality property", () => {
    const s = summarize(
      fc(
        point(0, 0, { status: "Available" }),
        point(1, 1, { status: "Occupied" }),
        point(2, 2, { status: "Available" })
      )
    );
    expect(s.properties.status.distinct).toBe(2);
    // This is the field that makes generated code correct first time.
    expect(s.properties.status.values).toEqual(["Available", "Occupied"]);
  });

  it("omits values for a high-cardinality property but still counts distinct", () => {
    const s = summarize(fc(...Array.from({ length: 30 }, (_, i) => point(i, i, { id: `x${i}` }))));
    expect(s.properties.id.distinct).toBe(30);
    expect(s.properties.id.values).toBeUndefined();
  });

  it("marks distinct as truncated past the cap and never inlines a partial list", () => {
    const s = summarize(fc(...Array.from({ length: 200 }, (_, i) => point(i, i, { id: i }))));
    expect(s.properties.id.distinctTruncated).toBe(true);
    expect(s.properties.id.values).toBeUndefined();
  });

  it("walks into nested objects with dotted paths", () => {
    const s = summarize(fc(point(0, 0, { poi: { name: "Cafe", brands: { primary: "X" } } })));
    expect(s.properties["poi.name"].type).toBe("string");
    expect(s.properties["poi.brands.primary"].type).toBe("string");
  });

  it("walks array ELEMENTS under a [] hop", () => {
    const s = summarize(
      fc(
        point(0, 0, {
          chargingPark: {
            connectors: [
              { currentType: "DCFast", ratedPowerKW: 175 },
              { currentType: "AC3", ratedPowerKW: 22 },
            ],
          },
        })
      )
    );
    // The path a code author needs — the connector field, not the array.
    expect(s.properties["chargingPark.connectors[].currentType"].values).toEqual(["AC3", "DCFast"]);
    expect(s.properties["chargingPark.connectors"].type).toBe("array");
  });

  it("samples the property scan on a large dataset but counts exactly", () => {
    const s = summarize(
      fc(...Array.from({ length: 2000 }, (_, i) => point(i % 90, i % 45, { i })))
    );
    expect(s.count).toBe(2000);
    // A summary that silently described 500 of 2000 would be worse than useless.
    expect(s.sampledFrom).toBe(500);
  });

  it("includes whole untrimmed features as the sample", () => {
    const feature = point(4.9, 52.3, { poi: { name: "Cafe de Jaren" } });
    const s = summarize(fc(feature, point(0, 0, {})), "places", 1);
    expect(s.sample).toEqual([feature]);
  });

  describe("envelope shapes", () => {
    it("handles a bare Feature (reverse geocode)", () => {
      const s = summarize(point(4.9, 52.3, { address: { freeformAddress: "Dam 1" } }), "places");
      expect(s.count).toBe(1);
      expect(s.properties["address.freeformAddress"].type).toBe("string");
    });

    it("handles the traffic incidents envelope", () => {
      const s = summarize(
        { incidents: [point(0, 0, { magnitudeOfDelay: 3 })], incidentSummary: { total: 1 } },
        "incidents"
      );
      expect(s.count).toBe(1);
      expect(s.envelopeKeys).toEqual(["incidentSummary"]);
    });

    it("reports envelope keys for a shape with no features (map state)", () => {
      const s = summarize({ sources: {}, layers: [], center: [0, 0] }, "mapState");
      expect(s.count).toBe(0);
      expect(s.envelopeKeys).toEqual(["sources", "layers", "center"]);
    });

    it("survives null and non-objects", () => {
      for (const value of [null, undefined, 42, "text"]) {
        const s = summarize(value);
        expect(s.count).toBe(0);
        expect(s.properties).toEqual({});
      }
    });
  });
});
