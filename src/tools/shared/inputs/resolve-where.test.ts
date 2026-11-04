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
import { whereSchemaFor } from "../../../schemas/shared/where";
import type { DatasetTool } from "../../../services/datasets/dataset-store";

const mockGeocodeAreas = vi.fn();
const mockFetchBoundaries = vi.fn();
const mockFuzzySearch = vi.fn();

vi.mock("../../../services/search/searchService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/search/searchService")>()),
  geocodeAreas: mockGeocodeAreas,
  fetchBoundaries: mockFetchBoundaries,
  fuzzySearch: mockFuzzySearch,
}));
vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  resolveNearby,
  resolveWithin,
  searchPlaceName,
  describeAreas,
  describeBias,
  resolvedAreasOf,
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

describe("resolveWithin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses an explicit bounding box as-is", async () => {
    const result = await resolveWithin({ mode: "within", boundingBox: [4, 52, 5, 53] });
    expect(result).toEqual([{ bbox: [4, 52, 5, 53], source: "boundingBox" }]);
    expect(mockGeocodeAreas).not.toHaveBeenCalled();
  });

  it("resolves area names to their outlines from a geocode each and one boundary request", async () => {
    mockGeocodeAreas
      .mockResolvedValueOnce({ features: [areaMatch("De Jordaan, Amsterdam", "b-1")] })
      .mockResolvedValueOnce({ features: [areaMatch("De Pijp, Amsterdam")] });
    mockFetchBoundaries.mockResolvedValueOnce({ features: [{ id: "b-1", geometry: square }] });

    const areas = await resolveWithin({ mode: "within", queries: ["De Jordaan", "De Pijp"] });

    expect(areas).toEqual([
      {
        bbox: [4, 52, 5, 53],
        polygon: square,
        boundaryId: "b-1",
        source: "query",
        query: "De Jordaan",
        label: "De Jordaan, Amsterdam",
      },
      { bbox: [4, 52, 5, 53], source: "query", query: "De Pijp", label: "De Pijp, Amsterdam" },
    ]);
    expect(mockFetchBoundaries).toHaveBeenCalledTimes(1);
    expect(mockFetchBoundaries).toHaveBeenCalledWith(["b-1"]);
  });

  it("resolves an earlier result's area to its outline again from its boundaryId", async () => {
    mockFetchBoundaries.mockResolvedValueOnce({ features: [{ id: "b-1", geometry: square }] });

    const [area] = await resolveWithin({
      mode: "within",
      areas: [{ name: "De Jordaan, Amsterdam", boundingBox: [4, 52, 5, 53], boundaryId: "b-1" }],
    });

    expect(mockGeocodeAreas).not.toHaveBeenCalled();
    expect(area).toEqual({
      bbox: [4, 52, 5, 53],
      polygon: square,
      boundaryId: "b-1",
      label: "De Jordaan, Amsterdam",
      source: "area",
    });
  });

  it("resolves an earlier result's area to its bounds with no request at all", async () => {
    const areas = await resolveWithin({
      mode: "within",
      areas: [
        { name: "De Jordaan, Amsterdam", boundingBox: [4, 52, 5, 53] },
        { name: "Ijburg", boundingBox: [5, 52, 5.1, 52.4] },
      ],
    });

    expect(mockGeocodeAreas).not.toHaveBeenCalled();
    expect(mockFetchBoundaries).not.toHaveBeenCalled();
    expect(areas).toEqual([
      { bbox: [4, 52, 5, 53], label: "De Jordaan, Amsterdam", source: "area" },
      { bbox: [5, 52, 5.1, 52.4], label: "Ijburg", source: "area" },
    ]);
  });

  it("takes back the area a named query reported, unchanged", async () => {
    mockGeocodeAreas.mockResolvedValue({ features: [areaMatch("De Jordaan, Amsterdam", "b-1")] });
    const [reported] = resolvedAreasOf(
      await resolveWithin({ mode: "within", queries: ["De Jordaan"] })
    );

    const whereSchema = whereSchemaFor(() => []);
    expect(whereSchema.safeParse({ mode: "within", areas: [reported.area] }).success).toBe(true);
  });

  it("reports a named area as searched by its outline, or its bounding box without one", async () => {
    mockGeocodeAreas.mockResolvedValue({ features: [areaMatch("Amsterdam", "b-1")] });
    mockFetchBoundaries.mockResolvedValueOnce({ features: [{ id: "b-1", geometry: square }] });
    const [outlined] = await resolveWithin({ mode: "within", queries: ["Amsterdam"] });
    mockFetchBoundaries.mockResolvedValueOnce({ features: [] });
    const [boxed] = await resolveWithin({ mode: "within", queries: ["Amsterdam"] });

    expect(describeAreas([outlined])).toBe("Amsterdam");
    expect(describeAreas([boxed])).toBe("Amsterdam (bounding box)");
  });

  it("says why a named or known area was searched by its bounding box when its outline fetch failed", async () => {
    const rateLimited = Object.assign(new Error("Too Many Requests"), { status: 429 });
    mockGeocodeAreas.mockResolvedValue({ features: [areaMatch("Amsterdam", "b-1")] });
    mockFetchBoundaries.mockRejectedValueOnce(rateLimited);
    const [named] = await resolveWithin({ mode: "within", queries: ["Amsterdam"] });
    mockFetchBoundaries.mockRejectedValueOnce(rateLimited);
    const [known] = await resolveWithin({
      mode: "within",
      areas: [{ name: "Amsterdam", boundingBox: [4, 52, 5, 53], boundaryId: "b-1" }],
    });

    for (const area of [named, known]) {
      expect(area.polygon).toBeUndefined();
      expect(describeAreas([area])).toMatch(
        /^Amsterdam \(bounding box: its outline could not be fetched, Rate limit exceeded/
      );
    }
  });

  it("fetches no outline for a lookup that keeps only the bounds", async () => {
    mockGeocodeAreas.mockResolvedValue({ features: [areaMatch("Amsterdam", "b-1")] });

    const areas = await resolveWithin(
      {
        mode: "within",
        queries: ["Amsterdam"],
        areas: [{ name: "Utrecht", boundingBox: [5, 52, 5.2, 52.2], boundaryId: "b-2" }],
      },
      { boundsOnly: true }
    );

    expect(mockFetchBoundaries).not.toHaveBeenCalled();
    expect(areas.map(({ bbox }) => bbox)).toEqual([
      [4, 52, 5, 53],
      [5, 52, 5.2, 52.2],
    ]);
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

  it("refuses a country, naming what to search instead", async () => {
    mockGeocodeAreas.mockResolvedValue({
      features: [
        {
          ...areaMatch("Greece"),
          properties: {
            geographyType: ["Country"],
            address: { freeformAddress: "Greece", countryCode: "GR" },
          },
        },
      ],
    });
    await expect(resolveWithin({ mode: "within", queries: ["Greece"] })).rejects.toMatchObject({
      message: expect.stringMatching(/country, too large.*mode "global".*countries/),
      data: { query: "Greece", countryCode: "GR" },
    });
  });

  it("requires at least one field", async () => {
    await expect(resolveWithin({ mode: "within" })).rejects.toThrow("at least one of");
  });

  it("takes a country's bounds when a lookup allows it", async () => {
    mockGeocodeAreas.mockResolvedValue({
      features: [
        {
          ...areaMatch("Greece"),
          properties: { geographyType: ["Country"], address: { freeformAddress: "Greece" } },
        },
      ],
    });
    const [area] = await resolveWithin(
      { mode: "within", queries: ["Greece"] },
      { allowCountry: true }
    );
    expect(area).toMatchObject({ bbox: [4, 52, 5, 53], label: "Greece" });
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

  const candidate = (id: string, coordinates: number[], properties: object) => ({
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates },
    properties,
  });

  it("resolves a query to a bias point with one search", async () => {
    mockFuzzySearch.mockResolvedValue({
      features: [candidate("centraal", [4.9, 52.4], { poi: { name: "Amsterdam Centraal" } })],
    });
    const bias = await resolveNearby({ mode: "nearby", query: "Amsterdam Centraal" });
    expect(bias).toMatchObject({ position: [4.9, 52.4], label: "Amsterdam Centraal" });
    expect(mockFuzzySearch).toHaveBeenCalledTimes(1);
    expect(mockGeocodeAreas).not.toHaveBeenCalled();
  });

  // The regression this function was rewritten for: an unscoped index answers
  // "Dam Square, Amsterdam" with Mill Dam Place, Leesburg, Virginia.
  it("discards a candidate that contradicts the area the query named", async () => {
    mockFuzzySearch.mockResolvedValue({
      features: [
        candidate("mill-dam-place", [-77.56, 39.11], {
          address: { freeformAddress: "Mill Dam Place, Leesburg, VA", country: "United States" },
        }),
      ],
    });
    await expect(
      resolveNearby({ mode: "nearby", query: "Dam Square, Amsterdam" })
    ).rejects.toMatchObject({
      message: expect.stringContaining("Could not resolve"),
      data: { query: "Dam Square, Amsterdam" },
    });
  });

  it("takes the candidate in the named area over the search's first", async () => {
    mockFuzzySearch.mockResolvedValue({
      features: [
        candidate("zeist", [5.23, 52.09], {
          poi: { name: "Dam Square Amsterdam" },
          address: { municipality: "Zeist" },
        }),
        candidate("dam", [4.8929, 52.3731], {
          address: { freeformAddress: "Dam, 1012 Amsterdam", municipality: "Amsterdam" },
        }),
      ],
    });

    const bias = await resolveNearby({ mode: "nearby", query: "Dam Square, Amsterdam" });

    expect(bias.position).toEqual([4.8929, 52.3731]);
  });

  it("accepts an exact name the search returns without the named area", async () => {
    mockFuzzySearch.mockResolvedValue({
      features: [
        candidate("westminster", [-0.1262362, 51.5001524], {
          type: "Geography",
          address: { freeformAddress: "Westminster" },
        }),
      ],
    });

    const bias = await resolveNearby({ mode: "nearby", query: "Westminster, London" });

    expect(bias.position).toEqual([-0.1262362, 51.5001524]);
  });

  it("asks the geocoder for an area of the name when no candidate is called it", async () => {
    mockFuzzySearch.mockResolvedValue({
      features: [
        candidate("vivant", [4.88, 52.37], {
          poi: { name: "Vivant de Jordaan" },
          address: { municipality: "Amsterdam" },
        }),
      ],
    });
    mockGeocodeAreas.mockResolvedValueOnce({
      features: [
        candidate("jordaan", [4.881, 52.374], {
          type: "Geography",
          address: { freeformAddress: "Jordaan, Amsterdam", municipality: "Amsterdam" },
        }),
      ],
    });

    const bias = await resolveNearby({ mode: "nearby", query: "De Jordaan, Amsterdam" });

    expect(bias).toMatchObject({ position: [4.881, 52.374], label: "Jordaan, Amsterdam" });
  });

  it("keeps the search's answer when the geocoder's area is called something else", async () => {
    mockFuzzySearch.mockResolvedValue({
      features: [
        candidate("dam", [4.8929, 52.3731], {
          address: { freeformAddress: "Dam, 1012 Amsterdam", municipality: "Amsterdam" },
        }),
      ],
    });
    mockGeocodeAreas.mockResolvedValueOnce({
      features: [
        candidate("centrum", [4.9, 52.37], {
          type: "Geography",
          address: { freeformAddress: "Centrum, Amsterdam", municipality: "Amsterdam" },
        }),
      ],
    });

    const bias = await resolveNearby({ mode: "nearby", query: "Dam Square, Amsterdam" });

    expect(bias.position).toEqual([4.8929, 52.3731]);
  });

  it("rejects a scope with neither a position nor a query", async () => {
    await expect(resolveNearby({ mode: "nearby", radiusMeters: 500 })).rejects.toMatchObject({
      message: expect.stringContaining("needs `position`"),
    });
    expect(mockFuzzySearch).not.toHaveBeenCalled();
  });

  // A widened search answers from the wrong continent while the response still
  // reports the scope it was asked for.
  it("fails rather than searching unbiased when nothing resolves", async () => {
    mockFuzzySearch.mockResolvedValue({ features: [] });
    await expect(resolveNearby({ mode: "nearby", query: "nowhere" })).rejects.toMatchObject({
      message: expect.stringContaining("Could not resolve"),
    });
  });

  it("reports a failing API as the failure, not as a name that did not resolve", async () => {
    mockFuzzySearch.mockRejectedValue(new Error("upstream down"));
    await expect(resolveNearby({ mode: "nearby", query: "Dam Square" })).rejects.toThrow(
      "upstream down"
    );
  });
});

describe("searchPlaceName", () => {
  const named = (geographyType: string, freeformAddress: string, countryCode: string) => ({
    type: "Feature",
    id: `${freeformAddress}-${countryCode}`,
    geometry: { type: "Point", coordinates: [0, 0] },
    properties: {
      type: "Geography",
      geographyType: [geographyType],
      address: { freeformAddress, countryCode },
    },
  });
  const collection = (...features: unknown[]) => ({ type: "FeatureCollection", features });

  beforeEach(() => vi.clearAllMocks());

  it("takes a country named exactly what was asked over a town the search ranked first, from one request", async () => {
    mockFuzzySearch.mockResolvedValue(
      collection(named("Municipality", "Greece, NY", "US"), named("Country", "Greece", "GR"))
    );

    const { ranked, matchedByName } = await searchPlaceName("Greece");

    expect(ranked[0].properties.address?.countryCode).toBe("GR");
    expect(matchedByName).toBe(true);
    expect(mockFuzzySearch).toHaveBeenCalledTimes(1);
    expect(mockGeocodeAreas).not.toHaveBeenCalled();
  });

  it("keeps the search's order over a hamlet named exactly what was asked", async () => {
    mockFuzzySearch.mockResolvedValue(
      collection(
        named("Municipality", "Frankfurt am Main", "DE"),
        named("MunicipalitySubdivision", "Frankfurt, Markt Taschendorf", "DE")
      )
    );

    const { ranked } = await searchPlaceName("Frankfurt");

    expect(ranked[0].properties.address?.freeformAddress).toBe("Frankfurt am Main");
  });

  it("lists an area once when the geocoder returns the one the search ranked below a business", async () => {
    const jordaan = named("Neighbourhood", "De Jordaan, Amsterdam", "NL");
    mockFuzzySearch.mockResolvedValue(
      collection(
        {
          type: "Feature",
          id: "cafe",
          geometry: { type: "Point", coordinates: [0, 0] },
          properties: { type: "POI", poi: { name: "Café De Jordaan" }, address: {} },
        },
        jordaan
      )
    );
    mockGeocodeAreas.mockResolvedValueOnce(collection(jordaan));

    const { ranked, exactMatches } = await searchPlaceName("De Jordaan");

    expect(ranked.map(({ id }) => id)).toEqual([jordaan.id, "cafe"]);
    expect(exactMatches).toBe(1);
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
        },
        { bbox: [0, 0, 1, 1], label: "Ijburg", source: "area" },
        { bbox: [0, 0, 1, 1], source: "boundingBox" },
      ])
    ).toEqual([
      {
        query: "Jordaan",
        matched: "Jordaan, Amsterdam",
        area: { name: "Jordaan, Amsterdam", boundingBox: [4, 52, 5, 53] },
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

  it("says when the radius is the default", () => {
    expect(describeBias({ position: [4.9, 52.37], radiusMeters: 1000, label: "Dam" })).toBe(
      "within 1000m (the default `radiusMeters`) of Dam"
    );
  });
});

const { clearDatasetStore, storeDataset } = await import(
  "../../../services/datasets/dataset-store"
);

describe("dataset scopes", () => {
  const store = (tool: DatasetTool, ...features: unknown[]) =>
    storeDataset({ type: "FeatureCollection", features }, { tool, params: {} });
  const route = {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [4.9, 52.37],
        [4.95, 52.4],
        [5.1, 52.5],
      ],
    },
    properties: {},
  };
  const point = {
    type: "Feature",
    geometry: { type: "Point", coordinates: [4.9, 52.37] },
    properties: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearDatasetStore();
  });

  it("reuses the polygons a dataset holds", async () => {
    const { id } = store("tomtom-locate-place", {
      type: "Feature",
      geometry: square,
      properties: {},
    });

    const [area] = await resolveWithin({ mode: "within", dataset_ids: [id] });

    expect(area).toMatchObject({ source: "dataset", polygon: square, bbox: [4, 52, 5, 53] });
    expect(mockGeocodeAreas).not.toHaveBeenCalled();
  });

  it("fetches the outlines of several located places in one request", async () => {
    const located = (boundaryId: string) =>
      store("tomtom-locate-place", {
        ...point,
        properties: { type: "Geography", dataSources: { geometry: { id: boundaryId } } },
      }).id;
    const ids = [located("b-1"), located("b-2")];
    mockFetchBoundaries.mockResolvedValueOnce({
      features: [
        { id: "b-1", geometry: square },
        { id: "b-2", geometry: square },
      ],
    });

    const areas = await resolveWithin({ mode: "within", dataset_ids: ids });

    expect(mockFetchBoundaries).toHaveBeenCalledTimes(1);
    expect(mockFetchBoundaries).toHaveBeenCalledWith(["b-1", "b-2"]);
    expect(areas.map(({ polygon }) => polygon)).toEqual([square, square]);
  });

  it("sends a route dataset to mode alongRoute rather than guessing a corridor", async () => {
    const { id } = store("tomtom-plan-route", route);

    await expect(resolveWithin({ mode: "within", dataset_ids: [id] })).rejects.toMatchObject({
      message: expect.stringContaining('mode "alongRoute"'),
      data: { dataset_id: id },
    });
  });

  it("explains a dataset that holds nothing to search within", async () => {
    const { id } = store("tomtom-discover-places", point);

    await expect(resolveWithin({ mode: "within", dataset_ids: [id] })).rejects.toMatchObject({
      message: expect.stringContaining("no polygon to search within"),
      data: { dataset_id: id },
    });
  });

  it("names a missing dataset in the error data, not the message", async () => {
    const rejection = resolveWithin({ mode: "within", dataset_ids: ["ds_gone"] });

    await expect(rejection).rejects.toMatchObject({ data: { dataset_id: "ds_gone" } });
    await expect(rejection).rejects.not.toThrow("ds_gone");
  });

  it("searches around a dataset's point", async () => {
    const { id } = store("tomtom-locate-place", point);

    expect(await resolveNearby({ mode: "nearby", dataset_id: id, radiusMeters: 300 })).toEqual({
      position: [4.9, 52.37],
      radiusMeters: 300,
    });
  });

  it("refuses a nearby dataset whose first feature is not a point", async () => {
    const { id } = store("tomtom-plan-route", route);

    await expect(resolveNearby({ mode: "nearby", dataset_id: id })).rejects.toMatchObject({
      data: { dataset_id: id },
    });
  });
});
