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

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGeocode = vi.fn();
const mockGeocodeAreas = vi.fn();
const mockFetchBoundaries = vi.fn();
const mockPoiSearch = vi.fn();

vi.mock("../../../services/search/searchService", () => ({
  geocodeAddress: mockGeocode,
  geocodeAreas: mockGeocodeAreas,
  fetchBoundaries: mockFetchBoundaries,
  hasBoundary: (place: { properties: { dataSources?: { geometry?: { id: string } } } }) =>
    Boolean(place.properties.dataSources?.geometry?.id),
  poiSearch: mockPoiSearch,
}));
vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { resolveNearby, resolveWithin, describeAreas, describeBias, resolvedAreasOf } = await import(
  "./resolve-where"
);

const square = {
  type: "Polygon" as const,
  coordinates: [
    [
      [4, 52],
      [5, 52],
      [5, 53],
      [4, 52],
    ],
  ],
};

/** An area match as the geocoder returns it: a point, its bounds, maybe a boundary id. */
const areaMatch = (label: string, boundaryId?: string) => ({
  type: "Feature",
  bbox: [4, 52, 5, 53],
  geometry: { type: "Point", coordinates: [4.5, 52.5] },
  properties: {
    address: { freeformAddress: label },
    ...(boundaryId && { dataSources: { geometry: { id: boundaryId } } }),
  },
});

describe("resolveWithin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses an explicit bounding box as-is", async () => {
    const result = await resolveWithin({ mode: "within", boundingBox: [4, 52, 5, 53] });
    expect(result).toEqual([{ bbox: [4, 52, 5, 53], source: "boundingBox" }]);
    expect(mockGeocodeAreas).not.toHaveBeenCalled();
  });

  // The reason `queries` exists: a bbox for a neighbourhood returns half the city.
  it("resolves an area name to its boundary polygon", async () => {
    mockGeocodeAreas.mockResolvedValue({ features: [areaMatch("De Jordaan, Amsterdam", "b-1")] });
    mockFetchBoundaries.mockResolvedValue({ features: [{ geometry: square }] });

    const [area] = await resolveWithin({ mode: "within", queries: ["De Jordaan"] });

    expect(area).toEqual({
      bbox: [4, 52, 5, 53],
      polygon: square,
      source: "query",
      query: "De Jordaan",
      label: "De Jordaan, Amsterdam",
    });
  });

  it("keeps the bounding box when the area has no boundary", async () => {
    mockGeocodeAreas.mockResolvedValue({ features: [areaMatch("Amsterdam")] });
    const [area] = await resolveWithin({ mode: "within", queries: ["Amsterdam"] });
    expect(area).toMatchObject({ bbox: [4, 52, 5, 53], polygon: undefined });
    expect(mockFetchBoundaries).not.toHaveBeenCalled();
  });

  it("keeps the bounding box when the boundary fetch fails", async () => {
    mockGeocodeAreas.mockResolvedValue({ features: [areaMatch("Amsterdam", "b-1")] });
    mockFetchBoundaries.mockRejectedValue(new Error("upstream down"));
    const [area] = await resolveWithin({ mode: "within", queries: ["Amsterdam"] });
    expect(area).toMatchObject({ bbox: [4, 52, 5, 53], polygon: undefined });
    expect(describeAreas([area])).toBe("Amsterdam (bounding box)");
  });

  it("unions every supplied field", async () => {
    mockGeocodeAreas.mockResolvedValue({ features: [areaMatch("Amsterdam")] });
    const result = await resolveWithin({
      mode: "within",
      boundingBox: [0, 0, 1, 1],
      queries: ["Amsterdam"],
      geometries: [square],
    });
    expect(result.map((area) => area.source).sort()).toEqual(["boundingBox", "geometry", "query"]);
    expect(result.find((area) => area.source === "geometry")?.bbox).toEqual([4, 52, 5, 53]);
  });

  it("fails rather than silently widening when an area name resolves to nothing", async () => {
    mockGeocodeAreas.mockResolvedValue({ features: [] });
    // Searching wherever the geocoder guessed would be worse than an error.
    await expect(resolveWithin({ mode: "within", queries: ["Atlantis"] })).rejects.toMatchObject({
      message: expect.stringMatching(/Could not resolve.*mode "nearby".*boundingBox/),
      data: { query: "Atlantis" },
    });
  });

  it("requires at least one field", async () => {
    await expect(resolveWithin({ mode: "within" })).rejects.toThrow("at least one of");
  });
});

describe("resolveNearby", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses an explicit position and defaults the radius", async () => {
    expect(await resolveNearby({ mode: "nearby", position: [4.9, 52.37] })).toEqual({
      position: [4.9, 52.37],
      radiusMeters: 1000,
    });
  });

  it("honours an explicit radius", async () => {
    const bias = await resolveNearby({ mode: "nearby", position: [0, 0], radiusMeters: 250 });
    expect(bias.radiusMeters).toBe(250);
  });

  it("resolves a query to a bias point", async () => {
    mockGeocode.mockResolvedValue({
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [4.9, 52.4] }, properties: {} },
      ],
    });
    mockPoiSearch.mockResolvedValue({ features: [] });
    const bias = await resolveNearby({ mode: "nearby", query: "Amsterdam Centraal" });
    expect(bias.position).toEqual([4.9, 52.4]);
  });

  it("takes the POI index's answer for a named landmark the geocoder misses", async () => {
    // A square, station or landmark lives in the POI index, not the address one.
    mockPoiSearch.mockResolvedValue({
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [4.893, 52.373] },
          properties: { poi: { name: "Dam Square" }, address: { municipality: "Amsterdam" } },
        },
      ],
    });
    mockGeocode.mockResolvedValue({ features: [] });
    const bias = await resolveNearby({ mode: "nearby", query: "Dam Square, Amsterdam" });
    expect(bias.position).toEqual([4.893, 52.373]);
  });

  // The regression this function was rewritten for: an unscoped index answers
  // "Dam Square, Amsterdam" with Mill Dam Place, Leesburg, Virginia.
  it("discards a candidate that contradicts the area the query named", async () => {
    mockPoiSearch.mockResolvedValue({ features: [] });
    mockGeocode.mockResolvedValue({
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-77.56, 39.11] },
          properties: {
            address: { freeformAddress: "Mill Dam Place, Leesburg, VA", country: "United States" },
          },
        },
      ],
    });
    await expect(
      resolveNearby({ mode: "nearby", query: "Dam Square, Amsterdam" })
    ).rejects.toMatchObject({
      message: expect.stringContaining("Could not resolve"),
      data: { query: "Dam Square, Amsterdam" },
    });
  });

  // Reversed deliberately: widening produced results on the wrong continent
  // while the response still reported the scope it had been asked for.
  it("fails rather than searching unbiased when nothing resolves", async () => {
    mockGeocode.mockRejectedValue(new Error("upstream down"));
    mockPoiSearch.mockRejectedValue(new Error("upstream down"));
    await expect(resolveNearby({ mode: "nearby", query: "nowhere" })).rejects.toMatchObject({
      message: expect.stringContaining("Could not resolve"),
    });
  });
});

describe("describeAreas", () => {
  it("reports what was actually searched", () => {
    expect(
      describeAreas([
        { bbox: [4, 52, 5, 53], polygon: square, label: "Amsterdam", query: "A", source: "query" },
        { bbox: [4, 52, 5, 53], label: "Utrecht", query: "U", source: "query" },
        { bbox: [0, 0, 1, 1], source: "boundingBox" },
      ])
    ).toBe("Amsterdam; Utrecht (bounding box); boundingBox");
  });
});

describe("resolvedAreasOf", () => {
  it("pairs each named area with its match, a label with commas included", () => {
    expect(
      resolvedAreasOf([
        { bbox: [4, 52, 5, 53], label: "Jordaan, Amsterdam", query: "Jordaan", source: "query" },
        { bbox: [0, 0, 1, 1], source: "boundingBox" },
      ])
    ).toEqual([{ query: "Jordaan", matched: "Jordaan, Amsterdam" }]);
  });
});

describe("describeBias", () => {
  it("names the point searched around, falling back to its coordinates", () => {
    expect(describeBias({ position: [4.9, 52.37], radiusMeters: 500, label: "Dam" })).toBe(
      "within 500m of Dam"
    );
    expect(describeBias({ position: [4.9, 52.37], radiusMeters: 500 })).toBe(
      "within 500m of 4.9, 52.37"
    );
    expect(describeBias({ radiusMeters: 500 })).toBe("no bias");
  });
});
