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
import type { DatasetTool } from "../../../schemas/shared/response-shapes";
import { BusyError } from "../../../types/types";

const mockGeocodeAreas = vi.fn();
const mockGeocodeAddress = vi.fn();
const mockFetchBoundaries = vi.fn();
const mockFuzzySearch = vi.fn();

vi.mock("../../../services/search/searchService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/search/searchService")>()),
  geocodeAreas: mockGeocodeAreas,
  geocodeAddress: mockGeocodeAddress,
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
  splitNamedQuery,
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
    const rateLimited = new BusyError(
      "The TomTom service is busy: wait a moment and retry.",
      {},
      { upstream: "tomtom-geometry-data" }
    );
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
        /^Amsterdam \(bounding box: its outline could not be fetched, The TomTom service is busy/
      );
    }
  });

  it("passes back a named area's boundaryId when its outline fetch failed, to fetch it next time", async () => {
    mockGeocodeAreas.mockResolvedValue({ features: [areaMatch("Amsterdam", "b-1")] });
    mockFetchBoundaries.mockRejectedValueOnce(new Error("upstream down"));

    const areas = await resolveWithin({ mode: "within", queries: ["Amsterdam"] });

    expect(resolvedAreasOf(areas)[0].area).toEqual({
      name: "Amsterdam",
      boundingBox: [4, 52, 5, 53],
      boundaryId: "b-1",
    });
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

  // The geocoder answers "Utrecht city centre" with City Centres the world over and no Utrecht.
  it("looks an area up again by the words its geocode lost, when it kept only generic ones", async () => {
    mockGeocodeAreas
      .mockResolvedValueOnce({ features: [areaMatch("Sun City Center, FL")] })
      .mockResolvedValueOnce({ features: [areaMatch("Utrecht")] });

    const [area] = await resolveWithin(
      { mode: "within", queries: ["Utrecht city centre"] },
      { boundsOnly: true }
    );

    expect(area).toMatchObject({ label: "Utrecht", query: "Utrecht city centre" });
    expect(mockGeocodeAreas).toHaveBeenLastCalledWith("utrecht", { limit: 10 });
  });

  it("keeps the first area when the lost words find none carrying them", async () => {
    mockGeocodeAreas
      .mockResolvedValueOnce({ features: [areaMatch("Sun City Center, FL")] })
      .mockResolvedValueOnce({ features: [areaMatch("Utrechtse Heuvelrug")] });

    const [area] = await resolveWithin(
      { mode: "within", queries: ["Utrecht city centre"] },
      { boundsOnly: true }
    );

    expect(area).toMatchObject({ label: "Sun City Center, FL" });
  });

  it("takes the area called what was asked in the area named, over the geocoder's first", async () => {
    mockGeocodeAreas.mockResolvedValueOnce({
      features: [
        { ...areaMatch("Sant Antoni de Vilamajor"), bbox: [2.3, 41.6, 2.4, 41.7] },
        {
          ...areaMatch("Sant Antoni, Barcelona"),
          properties: { address: { freeformAddress: "Sant Antoni, Barcelona" } },
        },
      ],
    });

    const areas = await resolveWithin(
      { mode: "within", queries: ["Sant Antoni, Barcelona"] },
      { boundsOnly: true }
    );

    expect(areas).toEqual([
      expect.objectContaining({ label: "Sant Antoni, Barcelona", bbox: [4, 52, 5, 53] }),
    ]);
  });

  // The geocoder knows Barcelona's Eixample only by its neighbourhoods.
  it("searches every area of the town holding most areas that hold the name, when none is called it", async () => {
    const part = (freeformAddress: string, municipality: string) => ({
      ...areaMatch(freeformAddress),
      properties: { address: { freeformAddress, municipality } },
    });
    mockGeocodeAreas.mockResolvedValueOnce({
      features: [
        part("Rabal de Baix-Eixample, Vall-llobrega", "Vall-llobrega"),
        part("la Dreta de l'Eixample, Barcelona", "Barcelona"),
        part("Gràcia, Barcelona", "Barcelona"),
        part("l'Antiga Esquerra de l'Eixample, Barcelona", "Barcelona"),
      ],
    });

    const areas = await resolveWithin(
      { mode: "within", queries: ["Eixample"] },
      { boundsOnly: true }
    );

    expect(areas.map((area) => "label" in area && area.label)).toEqual([
      "la Dreta de l'Eixample, Barcelona",
      "l'Antiga Esquerra de l'Eixample, Barcelona",
    ]);
  });

  it("asks once for an area that carries the name", async () => {
    mockGeocodeAreas.mockResolvedValueOnce({ features: [areaMatch("Rotterdam")] });

    await resolveWithin({ mode: "within", queries: ["Rotterdam city"] }, { boundsOnly: true });

    expect(mockGeocodeAreas).toHaveBeenCalledTimes(1);
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
    vi.resetAllMocks();
    mockGeocodeAreas.mockResolvedValue({ type: "FeatureCollection", features: [] });
    mockGeocodeAddress.mockResolvedValue({ type: "FeatureCollection", features: [] });
    mockFuzzySearch.mockResolvedValue({ type: "FeatureCollection", features: [] });
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

  it("resolves a query the search finds by name to a bias point with that one search", async () => {
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

  it("takes the geocoder's first area when it is called what was asked, over a business named after it", async () => {
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

describe("splitNamedQuery", () => {
  it("splits the place from the area that qualifies it, ignoring empty parts", () => {
    expect(splitNamedQuery("Dam Square, Amsterdam")).toEqual({
      subject: "Dam Square",
      area: "Amsterdam",
    });
    expect(splitNamedQuery("Paris, ")).toEqual({ subject: "Paris" });
    expect(splitNamedQuery(", Paris")).toEqual({ subject: "Paris" });
  });
});

describe("searchPlaceName", () => {
  /** A place where the live data has it: a point, and bounds for an area. */
  const named = (
    geographyType: string,
    freeformAddress: string,
    countryCode: string,
    coordinates: number[] = [0, 0],
    bbox?: number[]
  ) => ({
    type: "Feature",
    id: `${freeformAddress}-${countryCode}`,
    geometry: { type: "Point", coordinates },
    ...(bbox && { bbox }),
    properties: {
      type: "Geography",
      geographyType: [geographyType],
      address: { freeformAddress, countryCode },
    },
  });
  const venue = (name: string, coordinates: number[]) => ({
    type: "Feature",
    id: name,
    geometry: { type: "Point", coordinates },
    properties: { type: "POI", poi: { name }, address: {} },
  });
  const collection = (...features: unknown[]) => ({ type: "FeatureCollection", features });

  beforeEach(() => {
    vi.resetAllMocks();
    mockGeocodeAreas.mockResolvedValue(collection());
    mockGeocodeAddress.mockResolvedValue(collection());
    mockFuzzySearch.mockResolvedValue(collection());
  });

  const street = (freeformAddress: string, coordinates: number[]) => ({
    type: "Feature",
    id: freeformAddress,
    geometry: { type: "Point", coordinates },
    properties: { type: "Street", address: { freeformAddress } },
  });

  it("takes a country by its former name as the geocoder knows it now", async () => {
    mockGeocodeAreas.mockImplementation(async (query: string) =>
      query === "Türkiye"
        ? collection(named("Country", "Türkiye", "TR"))
        : collection(named("Municipality", "Turkey, TX", "US"))
    );

    const { ranked } = await searchPlaceName("Turkey");

    expect(ranked[0].id).toBe("Türkiye-TR");
    expect(mockFuzzySearch).not.toHaveBeenCalled();
  });

  // Vienna's addresses say Wien.
  it("holds a place called what was asked in the area named when it lies within the area's bounds", async () => {
    mockFuzzySearch.mockResolvedValue(
      collection(
        venue("Vienna Tours", [16.372, 48.208]),
        street("Stephansplatz, 1010 Wien", [16.373, 48.208])
      )
    );
    mockGeocodeAreas.mockImplementation(async (query: string) =>
      query === "Vienna"
        ? collection(
            named("Municipality", "Vienna", "AT", [16.37, 48.2], [16.18, 48.12, 16.58, 48.32])
          )
        : collection()
    );

    const { ranked } = await searchPlaceName("Stephansplatz, Vienna");

    expect(ranked[0].id).toBe("Stephansplatz, 1010 Wien");
  });

  it("takes a street called what was asked when nothing the search found is", async () => {
    mockFuzzySearch.mockResolvedValue(collection(venue("Marienplatz Munich", [10.9, 48.1])));
    mockGeocodeAddress.mockResolvedValue(
      collection(street("Marienplatz, München", [11.576, 48.137]))
    );
    mockGeocodeAreas.mockImplementation(async (query: string) =>
      query === "Munich"
        ? collection(
            named("Municipality", "Munich", "DE", [11.57, 48.13], [11.36, 48.06, 11.72, 48.25])
          )
        : collection()
    );

    const { ranked } = await searchPlaceName("Marienplatz, Munich");

    expect(ranked[0].id).toBe("Marienplatz, München");
  });

  it("looks a square up by its local name too", async () => {
    mockFuzzySearch.mockResolvedValue(
      collection(venue("Penthouse Amsterdam Dam Square", [4.893, 52.374]))
    );
    mockGeocodeAddress.mockImplementation(async (query: string) =>
      query === "Dam, Amsterdam"
        ? collection(street("Dam, 1012 Amsterdam", [4.893, 52.373]))
        : collection()
    );

    const { ranked } = await searchPlaceName("Dam Square, Amsterdam");

    expect(ranked[0].id).toBe("Dam, 1012 Amsterdam");
  });

  // The fuzzy search answers "Malta" with ten towns of that name and no country.
  it("takes a country name's areas, the country first, without searching", async () => {
    mockGeocodeAreas.mockResolvedValueOnce(
      collection(named("Municipality", "Malta, NY", "US"), named("Country", "Malta", "MT"))
    );
    mockFuzzySearch.mockResolvedValue(collection(named("Municipality", "Malta, NY", "US")));

    const { ranked, matchedByName } = await searchPlaceName("Malta");

    expect(ranked.map(({ id }) => id)).toEqual(["Malta-MT", "Malta, NY-US"]);
    expect(matchedByName).toBe(true);
    expect(mockFuzzySearch).not.toHaveBeenCalled();
  });

  it("takes the search's first called what was asked without asking the area lookup", async () => {
    mockGeocodeAreas.mockResolvedValueOnce(
      collection(named("Municipality", "Brooklyn Park, MN", "US"))
    );
    mockFuzzySearch.mockResolvedValue(
      collection(named("MunicipalitySubdivision", "Brooklyn, NY", "US"))
    );

    const { ranked } = await searchPlaceName("Brooklyn", { boundingBox: [-120, 30, -70, 50] });

    expect(ranked[0].id).toBe("Brooklyn, NY-US");
    expect(mockFuzzySearch).toHaveBeenCalledWith(
      "Brooklyn",
      expect.objectContaining({ boundingBox: [-120, 30, -70, 50] })
    );
    expect(mockGeocodeAreas).not.toHaveBeenCalled();
  });

  it("asks the geocoder when the search's first called what was asked lies outside the named area", async () => {
    mockGeocodeAreas.mockResolvedValueOnce(
      collection(named("MunicipalitySubdivision", "Le Marais, Paris", "FR"))
    );
    mockFuzzySearch.mockResolvedValue(
      collection(named("MunicipalitySubdivision", "Le Marais, Brussels", "BE"))
    );

    const { ranked } = await searchPlaceName("Le Marais, Paris");

    expect(ranked[0].id).toBe("Le Marais, Paris-FR");
  });

  it("asks the geocoder when the search's first only abbreviates what was asked", async () => {
    mockGeocodeAreas.mockResolvedValueOnce(collection(named("Municipality", "York", "GB")));
    mockFuzzySearch.mockResolvedValue(collection(named("CountrySubdivision", "Yorkshire", "GB")));

    const { ranked } = await searchPlaceName("York");

    expect(ranked[0].id).toBe("York-GB");
  });

  it("holds a place in an area whose box crosses the antimeridian", async () => {
    mockGeocodeAreas.mockResolvedValueOnce(
      collection(
        named("Municipality", "Anadyr", "RU"),
        named("CountrySubdivision", "Chukotka", "RU", [175, 65], [170, 60, -170, 70])
      )
    );
    mockFuzzySearch.mockResolvedValue(collection(venue("Chukotka Port", [179, 65])));

    const { ranked } = await searchPlaceName("Chukotka");

    expect(ranked[0].id).toBe("Chukotka-RU");
  });

  it("takes the geocoder's area over a street of the same name the search finds first", async () => {
    const street = {
      type: "Feature",
      id: "street",
      geometry: { type: "Point", coordinates: [4.88, 52.38] },
      properties: { type: "Street", address: { freeformAddress: "Jordaan, Amsterdam" } },
    };
    mockGeocodeAreas.mockResolvedValueOnce(
      collection(named("MunicipalitySubdivision", "Jordaan, Amsterdam", "NL"))
    );
    mockFuzzySearch.mockResolvedValue(collection(street));

    const { ranked } = await searchPlaceName("Jordaan");

    expect(ranked.map(({ id }) => id)).toEqual(["Jordaan, Amsterdam-NL"]);
  });

  it("takes a street called what was asked when the geocoder ranks no such area first", async () => {
    const street = {
      type: "Feature",
      id: "street",
      geometry: { type: "Point", coordinates: [4.88, 52.36] },
      properties: { type: "Street", address: { freeformAddress: "Leidseplein, Amsterdam" } },
    };
    mockFuzzySearch.mockResolvedValue(collection(street));

    const { ranked } = await searchPlaceName("Leidseplein");

    expect(ranked[0].id).toBe("street");
  });

  it("takes, of the areas called what was asked, the one named with the article asked for", async () => {
    mockGeocodeAreas.mockResolvedValueOnce(
      collection(
        named("Municipality", "Salvador", "BR"),
        named("Municipality", "El Salvador", "MX")
      )
    );

    const { ranked } = await searchPlaceName("El Salvador");

    expect(ranked[0].id).toBe("El Salvador-MX");
  });

  it("searches when the area lookup fails", async () => {
    mockGeocodeAreas.mockRejectedValueOnce(new Error("upstream down"));
    mockFuzzySearch.mockResolvedValue(collection(named("Country", "Malta", "MT")));

    const { ranked } = await searchPlaceName("Malta");

    expect(ranked[0].id).toBe("Malta-MT");
  });

  it("asks a failed area lookup for a country's name only once", async () => {
    mockGeocodeAreas.mockRejectedValue(new Error("upstream down"));
    mockFuzzySearch.mockResolvedValue(collection(venue("Lebanon Diner", [-75, 40])));

    const { ranked } = await searchPlaceName("Lebanon");

    expect(ranked[0].id).toBe("Lebanon Diner");
    expect(mockGeocodeAreas).toHaveBeenCalledTimes(1);
  });

  it("takes the geocoder's areas, unnamed as asked, when the search finds nothing", async () => {
    mockGeocodeAreas.mockResolvedValueOnce(
      collection(named("Municipality", "Sun City Center, FL", "US"))
    );

    const { ranked, matchedByName } = await searchPlaceName("Sun City Centre");

    expect(ranked.map(({ id }) => id)).toEqual(["Sun City Center, FL-US"]);
    expect(matchedByName).toBe(false);
  });

  it("looks the area up again by the words it lost, when the search finds nothing", async () => {
    mockGeocodeAreas
      .mockResolvedValueOnce(collection(named("Municipality", "Sun City Center, FL", "US")))
      .mockResolvedValueOnce(collection(named("Municipality", "Utrecht", "NL")));

    const { ranked } = await searchPlaceName("Utrecht city centre");

    expect(ranked.map(({ id }) => id)).toEqual(["Utrecht-NL"]);
    expect(mockGeocodeAreas).toHaveBeenLastCalledWith("utrecht", { limit: 10 });
  });

  it("holds the geocoder's first area to the area the query names", async () => {
    mockGeocodeAreas.mockResolvedValueOnce(collection(named("Country", "Malta", "MT")));
    mockFuzzySearch.mockResolvedValue(collection(named("Municipality", "Malta, NY", "US")));

    const { ranked } = await searchPlaceName("Malta, NY");

    expect(ranked[0].id).toBe("Malta, NY-US");
  });

  // What the live data holds: Frankfurt am Main first in both lookups, and
  // Frankfurt (Oder), then a hamlet, as the areas called exactly "Frankfurt".
  it("takes no area called what was asked that the geocoder ranks below its first", async () => {
    const amMain = named(
      "Municipality",
      "Frankfurt am Main",
      "DE",
      [8.68, 50.11],
      [8.47, 50.01, 8.8, 50.23]
    );
    const oder = named(
      "Municipality",
      "Frankfurt (Oder)",
      "DE",
      [14.55, 52.34],
      [14.39, 52.25, 14.6, 52.4]
    );
    mockGeocodeAreas.mockResolvedValueOnce(
      collection(
        amMain,
        oder,
        named("MunicipalitySubdivision", "Frankfurt, Markt Taschendorf", "DE")
      )
    );
    mockFuzzySearch.mockResolvedValue(
      collection(amMain, venue("Alte Oper Frankfurt", [8.67, 50.12]), oder)
    );

    const { ranked } = await searchPlaceName("Frankfurt");

    expect(ranked[0].id).toBe(amMain.id);
  });

  // The live fuzzy order puts a venue of Frankfurt am Main first, then the area
  // called exactly "Frankfurt" (Oder): the area holding most of the results wins.
  it("takes the area the name begins that holds most results over one called exactly it", async () => {
    const amMain = named(
      "Municipality",
      "Frankfurt am Main",
      "DE",
      [8.68, 50.11],
      [8.47, 50.01, 8.8, 50.23]
    );
    const oder = named(
      "Municipality",
      "Frankfurt (Oder)",
      "DE",
      [14.55, 52.34],
      [14.39, 52.25, 14.6, 52.4]
    );
    mockGeocodeAreas.mockResolvedValueOnce(collection(amMain, oder));
    mockFuzzySearch.mockResolvedValue(
      collection(
        venue("Frankfurt Hauptbahnhof", [8.66, 50.1]),
        venue("Frankfurt Airport", [8.57, 50.05]),
        amMain,
        venue("Alte Oper Frankfurt", [8.67, 50.12]),
        oder
      )
    );

    const { ranked } = await searchPlaceName("Frankfurt");

    expect(ranked[0].id).toBe(amMain.id);
  });

  it("takes the area called what was asked that holds the search's first, listing it once", async () => {
    const jordaan = named(
      "Neighbourhood",
      "Jordaan, Amsterdam",
      "NL",
      [4.88, 52.37],
      [4.87, 52.36, 4.89, 52.38]
    );
    mockGeocodeAreas.mockResolvedValueOnce(
      collection(named("MunicipalitySubdivision", "Jordaan Park, Heidelberg", "ZA"), jordaan)
    );
    mockFuzzySearch.mockResolvedValue(
      collection(venue("Jordaan Oproer", [4.884, 52.379]), jordaan)
    );

    const { ranked, exactMatches } = await searchPlaceName("Jordaan", {
      boundingBox: [4, 52, 5, 53],
    });

    expect(ranked.map(({ id }) => id)).toEqual([jordaan.id, "Jordaan Oproer"]);
    expect(mockGeocodeAreas).toHaveBeenCalledWith(
      "Jordaan",
      expect.objectContaining({ boundingBox: [4, 52, 5, 53] })
    );
    expect(exactMatches).toBe(1);
  });

  it("keeps the area it puts first ahead of a business that lists a phone number", async () => {
    const jordaan = named(
      "Neighbourhood",
      "Jordaan, Amsterdam",
      "NL",
      [4.88, 52.37],
      [4.87, 52.36, 4.89, 52.38]
    );
    const oproer = venue("Jordaan Oproer", [4.884, 52.379]);
    oproer.properties.poi = { name: "Jordaan Oproer", phone: "+31 20 000 0000" } as never;
    mockGeocodeAreas.mockResolvedValueOnce(
      collection(named("MunicipalitySubdivision", "Jordaan Park, Heidelberg", "ZA"), jordaan)
    );
    mockFuzzySearch.mockResolvedValue(collection(oproer, jordaan));

    const { ranked, matchedByName } = await searchPlaceName("Jordaan");

    expect(ranked.map(({ id }) => id)).toEqual([jordaan.id, "Jordaan Oproer"]);
    expect(matchedByName).toBe(true);
  });

  // The search's first is the town in Saskatchewan; then, places in Paris.
  it("takes the area called what was asked that holds more of what the search found than its first", async () => {
    const saskatchewan = named(
      "Municipality",
      "Montmartre SK",
      "CA",
      [-103.45, 50.21],
      [-103.46, 50.2, -103.44, 50.22]
    );
    const paris = named(
      "Neighbourhood",
      "Montmartre, Paris",
      "FR",
      [2.34, 48.886],
      [2.33, 48.88, 2.35, 48.892]
    );
    mockGeocodeAreas.mockResolvedValueOnce(collection(saskatchewan, paris));
    mockFuzzySearch.mockResolvedValue(
      collection(
        saskatchewan,
        venue("Musée de Montmartre", [2.34, 48.888]),
        venue("Le Consulat Montmartre", [2.341, 48.886])
      )
    );

    const { ranked } = await searchPlaceName("Montmartre");

    expect(ranked[0].id).toBe(paris.id);
  });

  it("keeps the search's first when an area called what was asked holds no more of what it found", async () => {
    const chile = named(
      "Municipality",
      "Sagrada Familia, Maule",
      "CL",
      [-71.38, -35],
      [-71.5, -35.1, -71.3, -34.9]
    );
    mockGeocodeAreas.mockResolvedValueOnce(
      collection(named("Municipality", "Familia, Iloilo", "PH"), chile)
    );
    mockFuzzySearch.mockResolvedValue(
      collection(venue("Templo de la Sagrada Familia", [2.17, 41.4]), chile)
    );

    const { ranked } = await searchPlaceName("Sagrada Familia");

    expect(ranked[0].id).toBe("Templo de la Sagrada Familia");
  });

  it("takes the search's landmark called what was asked over the geocoder's first area", async () => {
    mockGeocodeAreas.mockResolvedValueOnce(
      collection(named("Municipality", "Colosseum, QLD", "AU"))
    );
    mockFuzzySearch.mockResolvedValue(
      collection(venue("Colosseum", [12.49, 41.89]), named("Municipality", "Colosseum, QLD", "AU"))
    );

    const { ranked } = await searchPlaceName("Colosseum");

    expect(ranked[0].id).toBe("Colosseum");
  });

  // What the live data holds: villages whose names hold "Le Marais" first in
  // both lookups, then the areas called exactly that.
  it("takes the first area called what was asked when the search's first area only holds the name", async () => {
    const drouvin = named("Municipality", "Drouvin-le-Marais", "FR", [2.63, 50.49]);
    const ecouves = named("MunicipalitySubdivision", "Le Marais, Écouves", "FR", [0.03, 48.56]);
    mockGeocodeAreas.mockResolvedValueOnce(collection(drouvin, ecouves));
    mockFuzzySearch.mockResolvedValue(collection(drouvin, ecouves));

    const { ranked } = await searchPlaceName("Le Marais");

    expect(ranked[0].id).toBe(ecouves.id);
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
