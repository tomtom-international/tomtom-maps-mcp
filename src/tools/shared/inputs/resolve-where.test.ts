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
import { z } from "zod";

const mockGeocode = vi.fn();
const mockGeocodeAreas = vi.fn();
const mockFetchBoundaries = vi.fn();
const mockPoiSearch = vi.fn();

vi.mock("../../../services/search/searchService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/search/searchService")>()),
  geocodeAddress: mockGeocode,
  geocodeAreas: mockGeocodeAreas,
  fetchBoundaries: mockFetchBoundaries,
  poiSearch: mockPoiSearch,
}));
vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  boundsOfNamedArea,
  resolveNearby,
  resolveWithin,
  describeAreas,
  describeBias,
  modeBranch,
  modeUnion,
  resolvedAreasOf,
  whereSchema,
} = await import("./resolve-where");

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

describe("whereSchema", () => {
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

  it("reports the matched mode's own issue", () => {
    const { error } = whereSchema.safeParse({ mode: "nearby", query: "Dam", radiusMeters: -1 });
    expect(error?.issues).toMatchObject([{ code: "too_small", path: ["radiusMeters"] }]);
  });

  it("names a missing input of the matched mode, not the list of modes", () => {
    const required = modeUnion([
      modeBranch("global", {}),
      modeBranch("sorted", { sortBy: z.enum(["first", "second"]) }),
    ]);
    const [issue] = required.safeParse({ mode: "sorted" }).error?.issues ?? [];
    expect(issue.message).toMatch(/^sortBy: .*"first"\|"second"/);
  });
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
    mockFetchBoundaries.mockResolvedValue({ features: [{ id: "b-1", geometry: square }] });

    const [area] = await resolveWithin({ mode: "within", queries: ["De Jordaan"] });

    expect(area).toEqual({
      bbox: [4, 52, 5, 53],
      polygon: square,
      source: "query",
      query: "De Jordaan",
      label: "De Jordaan, Amsterdam",
      boundaryId: "b-1",
    });
  });

  it("resolves an earlier result's area to its boundary without geocoding the name", async () => {
    mockFetchBoundaries.mockResolvedValue({ features: [{ id: "b-1", geometry: square }] });

    const areas = await resolveWithin({
      mode: "within",
      areas: [
        { name: "De Jordaan, Amsterdam", boundingBox: [4, 52, 5, 53], boundaryId: "b-1" },
        { name: "Ijburg", boundingBox: [5, 52, 5.1, 52.4] },
      ],
    });

    expect(mockGeocodeAreas).not.toHaveBeenCalled();
    expect(mockFetchBoundaries).toHaveBeenCalledExactlyOnceWith(["b-1"]);
    expect(areas).toEqual([
      { bbox: [4, 52, 5, 53], polygon: square, label: "De Jordaan, Amsterdam", source: "area" },
      { bbox: [5, 52, 5.1, 52.4], label: "Ijburg", source: "area" },
    ]);
  });

  it("makes no request for an earlier result's area when only the bounds are wanted", async () => {
    const [area] = await resolveWithin(
      {
        mode: "within",
        areas: [{ name: "De Jordaan", boundingBox: [4, 52, 5, 53], boundaryId: "b-1" }],
      },
      { boundsOnly: true }
    );

    expect(mockFetchBoundaries).not.toHaveBeenCalled();
    expect(area).toEqual({ bbox: [4, 52, 5, 53], label: "De Jordaan", source: "area" });
  });

  it("takes back the area a named query reported, unchanged", async () => {
    mockGeocodeAreas.mockResolvedValue({ features: [areaMatch("De Jordaan, Amsterdam", "b-1")] });
    const [reported] = resolvedAreasOf(
      await resolveWithin({ mode: "within", queries: ["De Jordaan"] }, { boundsOnly: true })
    );

    expect(whereSchema.safeParse({ mode: "within", areas: [reported.area] }).success).toBe(true);
  });

  it("fetches every named area's boundary in one request, matched by id", async () => {
    mockGeocodeAreas.mockImplementation(async (query: string) => ({
      features: [areaMatch(query, query === "Utrecht" ? undefined : `b-${query}`)],
    }));
    mockFetchBoundaries.mockResolvedValue({
      features: [
        { id: "b-Rotterdam", geometry: { ...square, coordinates: [[[0, 0]]] } },
        { id: "b-Amsterdam", geometry: square },
      ],
    });

    const areas = await resolveWithin({
      mode: "within",
      queries: ["Amsterdam", "Utrecht", "Rotterdam"],
    });

    expect(mockFetchBoundaries).toHaveBeenCalledTimes(1);
    expect(mockFetchBoundaries.mock.calls[0][0]).toHaveLength(2);
    expect(areas.map((area) => area.polygon?.coordinates)).toEqual([
      square.coordinates,
      undefined,
      [[[0, 0]]],
    ]);
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

  it("skips the boundary fetch when only the bounds are wanted", async () => {
    mockGeocodeAreas.mockResolvedValue({ features: [areaMatch("De Jordaan, Amsterdam", "b-1")] });

    const [area] = await resolveWithin(
      { mode: "within", queries: ["De Jordaan"] },
      { boundsOnly: true }
    );

    expect(area).toEqual({
      bbox: [4, 52, 5, 53],
      source: "query",
      query: "De Jordaan",
      label: "De Jordaan, Amsterdam",
      boundaryId: "b-1",
    });
    expect(mockFetchBoundaries).not.toHaveBeenCalled();
  });

  it.each<[string, { type: "Polygon" | "MultiPolygon"; coordinates: unknown[] }]>([
    [
      "a Polygon missing a level of nesting",
      { type: "Polygon", coordinates: square.coordinates[0] },
    ],
    [
      "a MultiPolygon given a Polygon's rings",
      { type: "MultiPolygon", coordinates: square.coordinates },
    ],
    ["a Polygon with no rings", { type: "Polygon", coordinates: [] }],
  ])("rejects %s, naming the expected nesting", async (_name, geometry) => {
    await expect(resolveWithin({ mode: "within", geometries: [geometry] })).rejects.toMatchObject({
      message: expect.stringContaining("an array of rings"),
      data: { index: 0, type: geometry.type },
    });
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
          id: "dam-square",
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
          id: "mill-dam-place",
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

  // What the live indexes return: the POI index's only "Eiffel Tower" hit is the
  // replica in Paris, Texas, whose address contains "Paris" too.
  it("ranks a name's candidates as locate-place does, not by the first in the named area", async () => {
    const street = (freeformAddress: string, coordinates: number[]) => ({
      type: "Feature",
      id: freeformAddress,
      geometry: { type: "Point", coordinates },
      properties: { type: "Street", address: { freeformAddress } },
    });
    mockPoiSearch.mockResolvedValue({
      features: [
        {
          type: "Feature",
          id: "eiffel-tower-paris-texas",
          geometry: { type: "Point", coordinates: [-95.5477, 33.6626] },
          properties: {
            type: "POI",
            poi: { name: "Eiffel Tower Paris Texas" },
            address: { freeformAddress: "Paris, TX 75460", municipality: "Paris" },
          },
        },
      ],
    });
    mockGeocode.mockResolvedValue({
      features: [
        street("Avenue Gustave Eiffel, 75007 Paris", [2.295, 48.8577]),
        street("Esplanade des Ouvriers de la Tour Eiffel, 75007 Paris", [2.294, 48.859]),
      ],
    });

    const bias = await resolveNearby({ mode: "nearby", query: "Eiffel Tower, Paris" });

    expect(bias).toMatchObject({
      position: [2.295, 48.8577],
      label: "Avenue Gustave Eiffel, 75007 Paris",
    });
  });

  it("accepts an exact name the geocoder returns without the named area", async () => {
    mockPoiSearch.mockResolvedValue({ features: [] });
    mockGeocode.mockResolvedValue({
      features: [
        {
          type: "Feature",
          id: "westminster",
          geometry: { type: "Point", coordinates: [-0.1262362, 51.5001524] },
          properties: { type: "Geography", address: { freeformAddress: "Westminster" } },
        },
      ],
    });

    const bias = await resolveNearby({ mode: "nearby", query: "Westminster, London" });

    expect(bias.position).toEqual([-0.1262362, 51.5001524]);
  });

  it("confines a name's lookup to the area its query names, by bounds alone", async () => {
    mockGeocodeAreas.mockResolvedValue({ features: [areaMatch("Amsterdam", "boundary-1")] });
    mockPoiSearch.mockResolvedValue({ features: [] });
    mockGeocode.mockResolvedValue({
      features: [
        {
          type: "Feature",
          id: "dam",
          geometry: { type: "Point", coordinates: [4.8929, 52.3731] },
          properties: { type: "Street", address: { freeformAddress: "Dam, 1012 Amsterdam" } },
        },
      ],
    });

    await resolveNearby({ mode: "nearby", query: "Dam Square, Amsterdam" });

    expect(mockGeocodeAreas).toHaveBeenCalledWith("Amsterdam", expect.anything());
    expect(mockGeocode).toHaveBeenCalledWith(
      "Dam Square, Amsterdam",
      expect.objectContaining({ boundingBox: [4, 52, 5, 53] })
    );
    expect(mockFetchBoundaries).not.toHaveBeenCalled();
  });

  it("rejects a scope with neither a position nor a query", async () => {
    await expect(resolveNearby({ mode: "nearby", radiusMeters: 500 })).rejects.toMatchObject({
      message: expect.stringContaining("needs `position`"),
    });
    expect(mockPoiSearch).not.toHaveBeenCalled();
    expect(mockGeocode).not.toHaveBeenCalled();
  });

  // Reversed deliberately: widening produced results on the wrong continent
  // while the response still reported the scope it had been asked for.
  it("fails rather than searching unbiased when nothing resolves", async () => {
    mockGeocode.mockResolvedValue({ features: [] });
    mockPoiSearch.mockResolvedValue({ features: [] });
    await expect(resolveNearby({ mode: "nearby", query: "nowhere" })).rejects.toMatchObject({
      message: expect.stringContaining("Could not resolve"),
    });
  });

  it("reports a failing API as the failure, not as a name that did not resolve", async () => {
    mockGeocode.mockRejectedValue(new Error("upstream down"));
    mockPoiSearch.mockRejectedValue(new Error("upstream down"));
    await expect(resolveNearby({ mode: "nearby", query: "Dam Square" })).rejects.toThrow(
      "upstream down"
    );
  });
});

describe("boundsOfNamedArea", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("looks nothing up for a query that names no area", async () => {
    expect(await boundsOfNamedArea(undefined)).toEqual({});
    expect(mockGeocodeAreas).not.toHaveBeenCalled();
  });

  it("leaves a lookup unscoped when the area cannot be resolved", async () => {
    mockGeocodeAreas.mockRejectedValue(new Error("no such area"));
    expect(await boundsOfNamedArea("the one near the park")).toEqual({});
  });
});

describe("describeAreas", () => {
  it("reports what was actually searched", () => {
    expect(
      describeAreas([
        { bbox: [4, 52, 5, 53], polygon: square, label: "Amsterdam", query: "A", source: "query" },
        { bbox: [4, 52, 5, 53], label: "Utrecht", query: "U", source: "query" },
        { bbox: [0, 0, 1, 1], source: "boundingBox" },
        { bbox: [0, 0, 1, 1], label: "Ijburg", source: "area" },
      ])
    ).toBe("Amsterdam; Utrecht (bounding box); boundingBox; Ijburg (bounding box)");
  });
});

describe("resolvedAreasOf", () => {
  it("pairs each named area with its match and the area to pass back, a label with commas included", () => {
    expect(
      resolvedAreasOf([
        {
          bbox: [4, 52, 5, 53],
          label: "Jordaan, Amsterdam",
          query: "Jordaan",
          source: "query",
          boundaryId: "b-1",
        },
        { bbox: [0, 0, 1, 1], label: "Ijburg", source: "area" },
        { bbox: [0, 0, 1, 1], source: "boundingBox" },
      ])
    ).toEqual([
      {
        query: "Jordaan",
        matched: "Jordaan, Amsterdam",
        area: { name: "Jordaan, Amsterdam", boundingBox: [4, 52, 5, 53], boundaryId: "b-1" },
      },
    ]);
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
  });
});
