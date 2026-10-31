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

import * as turf from "@turf/turf";
import type { Position } from "geojson";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadFixture } from "../shared/__fixtures__";
import { LANDMARKS } from "../shared/__fixtures__/landmarks";
import { APP_DATA } from "../shared/app-data";

const mocks = {
  geocodeAreas: vi.fn(),
  fetchBoundaries: vi.fn(),
  fuzzySearch: vi.fn(),
  searchInAreas: vi.fn(),
  searchAlongRoute: vi.fn(),
  getRoute: vi.fn(),
};

vi.mock("../../services/search/searchService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/search/searchService")>()),
  geocodeAreas: mocks.geocodeAreas,
  fetchBoundaries: mocks.fetchBoundaries,
  fuzzySearch: mocks.fuzzySearch,
  searchInAreas: mocks.searchInAreas,
  searchAlongRoute: mocks.searchAlongRoute,
  // Every category resolves except the word "xyzzy".
  resolveCategories: async (inputs: string[]) => ({
    poiCategories: inputs.filter((input) => input !== "xyzzy"),
    unmatched: inputs.filter((input) => input === "xyzzy"),
  }),
}));

vi.mock("../../services/routing/routingService", () => ({ getRoute: mocks.getRoute }));

vi.mock("../shared/inputs/resolve-where", async (importOriginal) => ({
  // The pure name helpers are the real ones — locate-place's ranking IS the
  // thing under test here, and stubbing them would test the stubs.
  ...(await importOriginal<typeof import("../shared/inputs/resolve-where")>()),
  resolveWithin: vi.fn(),
  resolveNearby: vi.fn(),
  describeAreas: vi.fn(() => ""),
}));

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { discoverPlacesHandler, locatePlaceHandler } = await import("./discover-places");

const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

/** One geocoder-shaped hit, enough for the handler to get past its empty check. */
const oneFeature = (name: string) => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: name,
      geometry: { type: "Point", coordinates: [4.89, 52.37] },
      properties: { address: { freeformAddress: name } },
    },
  ],
});

// Measured against the live API: a category filter plus `query: "*"` returns
// ZERO features from the geometry and fuzzy endpoints, where "*" is a literal
// search term rather than a wildcard. `""` is the category-only search and
// returns results. This broke the flagship shape of the whole consolidation —
// "Italian restaurants in Amsterdam" as poiCategories + where.within — and
// every eval missed it: the selection suites assert which tool was called, and
// the capability judge scored an empty result as an honest "nothing found".
describe("category-only search", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { resolveWithin } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveWithin).mockResolvedValue([
      {
        bbox: [4.7289, 52.278009, 5.107671, 52.431229],
        label: "Amsterdam",
        query: "Amsterdam",
        source: "query",
      },
    ]);
    mocks.searchInAreas.mockResolvedValue({ type: "FeatureCollection", features: [] });
  });

  it("sends an empty query, not a literal asterisk, when only categories are given", async () => {
    await discoverPlacesHandler({
      poiCategories: ["RESTAURANT"],
      where: { mode: "within", queries: ["Amsterdam"] },
    });

    expect(mocks.searchInAreas).toHaveBeenCalledWith(
      "",
      expect.anything(),
      expect.objectContaining({ poiCategories: ["RESTAURANT"] })
    );
  });

  it("searches an area without a boundary as its bounding rectangle", async () => {
    await discoverPlacesHandler({
      poiCategories: ["RESTAURANT"],
      where: { mode: "within", queries: ["Amsterdam"] },
    });

    const [[, [area]]] = mocks.searchInAreas.mock.calls;
    expect(area.type).toBe("Polygon");
    expect(area.coordinates[0]).toHaveLength(5);
    expect(area.coordinates[0]).toEqual(
      expect.arrayContaining([
        [4.7289, 52.278009],
        [5.107671, 52.431229],
      ])
    );
  });

  it("still passes the caller's free text when there is some", async () => {
    await discoverPlacesHandler({
      query: "italian",
      poiCategories: ["RESTAURANT"],
      where: { mode: "within", queries: ["Amsterdam"] },
    });

    expect(mocks.searchInAreas).toHaveBeenCalledWith(
      "italian",
      expect.anything(),
      expect.anything()
    );
  });

  it("reports the categories it could not resolve alongside the results", async () => {
    const response = await discoverPlacesHandler({
      poiCategories: ["RESTAURANT", "xyzzy"],
      where: { mode: "within", queries: ["Amsterdam"] },
    });

    expect(parse(response).searched).toMatchObject({
      poiCategories: ["RESTAURANT"],
      unresolvedCategories: ["xyzzy"],
    });
  });

  it("fails, naming the words, when no category resolves", async () => {
    const response = await discoverPlacesHandler({
      poiCategories: ["xyzzy"],
      where: { mode: "within", queries: ["Amsterdam"] },
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("xyzzy");
    expect(mocks.searchInAreas).not.toHaveBeenCalled();
  });
});

describe("within: ranking, summary and charger filters", () => {
  const place = (
    id: string,
    coordinates: Position,
    properties: Record<string, unknown> = { poi: { name: id, categories: ["cafe"] } }
  ) => ({ type: "Feature", id, geometry: { type: "Point", coordinates }, properties });
  const charger = (id: string, connectors: [string, number, number][]) =>
    place(id, [4.9, 52.37], {
      poi: { name: id, categories: ["electric vehicle station"] },
      chargingPark: {
        connectors: connectors.map(([type, ratedPowerKW, count]) => ({
          connector: { type, ratedPowerKW },
          count,
        })),
      },
    });
  const searched = (...features: unknown[]) =>
    mocks.searchInAreas.mockResolvedValue({ type: "FeatureCollection", features });

  beforeEach(async () => {
    vi.clearAllMocks();
    const { resolveWithin } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveWithin).mockResolvedValue([
      { bbox: [4.8, 52.3, 5.0, 52.4], label: "Amsterdam", query: "Amsterdam", source: "query" },
    ]);
  });

  it("asks for a pool and returns the places nearest the area's centre first", async () => {
    searched(
      place("edge", [4.81, 52.31]),
      place("centre", [4.9, 52.35]),
      place("between", [4.85, 52.33])
    );

    const result = parse(
      await discoverPlacesHandler({
        poiCategories: ["cafe"],
        where: { mode: "within", queries: ["Amsterdam"] },
        limit: 2,
      })
    );

    expect(mocks.searchInAreas).toHaveBeenCalledWith(
      "",
      expect.anything(),
      expect.objectContaining({ limit: 50 })
    );
    expect(
      result.features.map(
        (feature: { properties: { poi: { name: string } } }) => feature.properties.poi.name
      )
    ).toEqual(["centre", "between"]);
    expect(result.summary).toMatchObject({
      places: 2,
      covers: expect.stringContaining("more matched"),
    });
  });

  it("takes each area's nearest in turn, so a large area cannot crowd out a small one", async () => {
    const { resolveWithin } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveWithin).mockResolvedValue([
      { bbox: [4.8, 52.3, 5.0, 52.4], label: "Amsterdam", query: "Amsterdam", source: "query" },
      { bbox: [5.0, 52.0, 5.2, 52.2], label: "Utrecht", query: "Utrecht", source: "query" },
    ]);
    searched(
      place("amsterdam 1", [4.9, 52.35]),
      place("amsterdam 2", [4.91, 52.36]),
      place("amsterdam 3", [4.88, 52.34]),
      place("utrecht 1", [5.1, 52.1])
    );

    const result = parse(
      await discoverPlacesHandler({
        poiCategories: ["cafe"],
        where: { mode: "within", queries: ["Amsterdam", "Utrecht"] },
        limit: 3,
      })
    );

    expect(
      result.features.map(
        (feature: { properties: { poi: { name: string } } }) => feature.properties.poi.name
      )
    ).toEqual(["amsterdam 1", "utrecht 1", "amsterdam 2"]);
  });

  it("counts the places by category, and chargers by connector type and power", async () => {
    searched(
      charger("a", [
        ["IEC62196Type2CCS", 150, 4],
        ["IEC62196Type2Outlet", 22, 2],
      ]),
      charger("b", [["IEC62196Type2CCS", 150, 2]])
    );

    const { summary } = parse(
      await discoverPlacesHandler({
        poiCategories: ["CHARGING_LOCATION"],
        where: { mode: "within", queries: ["Amsterdam"] },
      })
    );

    expect(summary).toEqual({
      places: 2,
      covers: "Every place the search matched.",
      byCategory: { "electric vehicle station": 2 },
      byConnector: [
        { connectorType: "IEC62196Type2CCS", ratedPowerKW: 150, stations: 2, connectors: 6 },
        { connectorType: "IEC62196Type2Outlet", ratedPowerKW: 22, stations: 1, connectors: 2 },
      ],
    });
  });

  it("passes the charger filters to the search, and says they were applied", async () => {
    searched();

    const result = parse(
      await discoverPlacesHandler({
        poiCategories: ["CHARGING_LOCATION"],
        where: { mode: "within", queries: ["Amsterdam"] },
        minPowerKW: 50,
        connectors: ["IEC62196Type2CCS"],
      })
    );

    expect(mocks.searchInAreas).toHaveBeenCalledWith(
      "",
      expect.anything(),
      expect.objectContaining({ minPowerKW: 50, connectors: ["IEC62196Type2CCS"] })
    );
    expect(result.searched.chargers).toMatchObject({
      minPowerKW: 50,
      connectors: ["IEC62196Type2CCS"],
      matched: expect.stringContaining("other connectors are listed too"),
    });
  });

  it("reports no charger filter when none was asked for", async () => {
    searched();

    const result = parse(
      await discoverPlacesHandler({
        poiCategories: ["CHARGING_LOCATION"],
        where: { mode: "within", queries: ["Amsterdam"] },
      })
    );

    expect(result.searched.chargers).toBeUndefined();
  });
});

describe("locatePlaceHandler", () => {
  const candidate = (
    id: string,
    name: string,
    coordinates: Position,
    address: Record<string, string> = {}
  ) => ({
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates },
    properties: { type: "POI", poi: { name }, address },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fuzzySearch.mockResolvedValue(oneFeature("Dam, 1012 Amsterdam"));
  });

  // One request a name: the fuzzy index holds both the places and the
  // addresses, so asking the POI index and the geocoder separately, and the
  // query's area for a bounding box first, tripled what a lookup cost.
  it("asks one search, with the query as given, for several candidates", async () => {
    await locatePlaceHandler({ query: "Dam Square, Amsterdam", show_ui: false } as never);

    expect(mocks.fuzzySearch).toHaveBeenCalledTimes(1);
    expect(mocks.fuzzySearch).toHaveBeenCalledWith("Dam Square, Amsterdam", { limit: 10 });
    expect(mocks.geocodeAreas).not.toHaveBeenCalled();
  });

  // What the live index returns for this query: first a business called "Dam
  // Square Amsterdam" in Zeist, then businesses on the square. The square
  // itself is not among them.
  it("prefers a candidate in the area the query names over the search's first", async () => {
    mocks.fuzzySearch.mockResolvedValue({
      features: [
        candidate("zeist", "Dam Square Amsterdam", [5.23, 52.09], { municipality: "Zeist" }),
        candidate("penthouse", "Penthouse Amsterdam Dam Square", [4.89672, 52.37675], {
          municipality: "Amsterdam",
        }),
      ],
    });

    const body = parse(
      await locatePlaceHandler({ query: "Dam Square, Amsterdam", show_ui: false } as never)
    );

    expect(body.located).toBe("Penthouse Amsterdam Dam Square");
    // Nothing was named "Dam Square", so the answer is an inference and says so.
    expect(body.matchNote).toContain('Nothing is named exactly "Dam Square"');
    // …but the disclosure must not read as "distrust this". Measured: the note
    // said "check `located` before relying on the coordinates", and in one
    // benchmark run the model discarded a CORRECT result and answered from
    // general knowledge instead, which the grounding judge scored as invented.
    expect(body.matchNote).toContain("Answer with its coordinates");
    expect(body.matchNote).toContain("Do not replace them with coordinates from memory");
  });

  it("prefers the exact name within the named area over a longer one", async () => {
    mocks.fuzzySearch.mockResolvedValue({
      features: [
        candidate("library", "Rijksmuseum Research Library Amsterdam", [4.885185, 52.360004]),
        candidate("museum", "Rijksmuseum", [4.885219, 52.359998]),
      ],
    });

    const body = parse(
      await locatePlaceHandler({ query: "Rijksmuseum, Amsterdam", show_ui: false } as never)
    );

    expect(body.located).toBe("Rijksmuseum");
    // An exact match is an answer, not a guess.
    expect(body.matchNote).toBeUndefined();
  });

  // An exact name with no area to hold it to proves nothing: "Frankfurt"
  // exactly is a Legoland ride, and the search's first is the city.
  it("keeps the search's order when the query names no area", async () => {
    mocks.fuzzySearch.mockResolvedValue({
      features: [
        candidate("city", "Frankfurt am Main", [8.6821, 50.1109]),
        candidate("ride", "Frankfurt", [9.1275, 55.735]),
      ],
    });

    const body = parse(await locatePlaceHandler({ query: "Frankfurt", show_ui: false } as never));

    expect(body.located).toBe("Frankfurt am Main");
  });

  it("reports a tie between two places of the same name rather than picking one", async () => {
    // Amsterdam really does carry two POIs named exactly "Rijksmuseum", both
    // categorised MUSEUM, 1.7 km apart. Nothing in the data chooses between them.
    mocks.fuzzySearch.mockResolvedValue({
      features: [
        candidate("place-9", "Rijksmuseum", [4.907771, 52.370086]),
        candidate("place-10", "Rijksmuseum", [4.885219, 52.359998]),
      ],
    });

    const body = parse(
      await locatePlaceHandler({ query: "Rijksmuseum, Amsterdam", show_ui: false } as never)
    );

    expect(body.ambiguityNote).toContain("2 places are named exactly");
    expect(body.alternatives).toContain("Rijksmuseum");
  });

  // `within` once also sent its centre as `position`, which the search
  // prefers — so the hard scope silently became a weak bias. Measured: bbox
  // alone gives "Dam, 1012 Amsterdam"; bbox + centre gives "Beaver Dam Place,
  // Zion Crossroads, VA".
  it('constrains a "within" scope by bounding box alone, with no position bias', async () => {
    const { resolveWithin } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveWithin).mockResolvedValue([
      { bbox: [4.7289, 52.278009, 5.107671, 52.431229], label: "Amsterdam" },
    ] as never);

    await locatePlaceHandler({
      query: "Dam Square",
      where: { mode: "within", queries: ["Amsterdam"] },
      show_ui: false,
    } as never);

    const options = mocks.fuzzySearch.mock.calls[0][1];
    expect(options.boundingBox).toEqual([4.7289, 52.278009, 5.107671, 52.431229]);
    expect(options).not.toHaveProperty("position");
    expect(resolveWithin).toHaveBeenCalledWith(expect.anything(), { boundsOnly: true });
  });

  it('constrains a "within" scope of several areas by the bounds of them all', async () => {
    const { resolveWithin } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveWithin).mockResolvedValue([
      { bbox: [4.7289, 52.278009, 5.107671, 52.431229], label: "Amsterdam" },
      { bbox: [4.35, 51.85, 4.6, 52.0], label: "Rotterdam" },
    ] as never);

    await locatePlaceHandler({
      query: "Markthal",
      where: { mode: "within", queries: ["Amsterdam", "Rotterdam"] },
      show_ui: false,
    } as never);

    expect(mocks.fuzzySearch.mock.calls[0][1].boundingBox).toEqual([
      4.35, 51.85, 5.107671, 52.431229,
    ]);
  });

  it("gives the app the located place and the alternatives the text names, no more", async () => {
    mocks.fuzzySearch.mockResolvedValue({
      features: [0, 1, 2, 3, 4, 5, 6].map((index) =>
        candidate(`rijksmuseum-${index}`, `Rijksmuseum ${index}`, [4.88 + index / 10, 52.36])
      ),
    });

    const response = await locatePlaceHandler({ query: "Rijksmuseum", show_ui: true } as never);
    const body = parse(response);
    const drawn = response[APP_DATA]?.data as { features: { id: string }[] };

    expect(body.alternatives).toHaveLength(3);
    expect(drawn.features).toHaveLength(4);
    expect(drawn.features[0].id).toBe("rijksmuseum-0");
  });

  it('passes a "nearby" scope as a position bias, without a radius it was not given', async () => {
    const { resolveNearby } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveNearby).mockResolvedValue({ position: [4.9, 52.37], radiusMeters: 1000 });

    await locatePlaceHandler({
      query: "Dam Square",
      where: { mode: "nearby", query: "Amsterdam" },
      show_ui: false,
    } as never);

    const options = mocks.fuzzySearch.mock.calls[0][1];
    expect(options.position).toEqual([4.9, 52.37]);
    expect(options).not.toHaveProperty("radius");
    expect(options).not.toHaveProperty("boundingBox");
  });

  it('keeps a "nearby" scope\'s radiusMeters', async () => {
    const { resolveNearby } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveNearby).mockResolvedValue({ position: [4.9, 52.37], radiusMeters: 500 });

    await locatePlaceHandler({
      query: "Dam Square",
      where: { mode: "nearby", position: [4.9, 52.37], radiusMeters: 500 },
      show_ui: false,
    } as never);

    expect(mocks.fuzzySearch.mock.calls[0][1]).toMatchObject({
      position: [4.9, 52.37],
      radius: 500,
    });
  });

  it("fails, suggesting a narrower lookup, when nothing matches", async () => {
    mocks.fuzzySearch.mockResolvedValue({ type: "FeatureCollection", features: [] });

    const response = await locatePlaceHandler({ query: "Xyzzy Plaza" });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("Could not locate the query");
  });

  it("reports a failing API as the failure, not as a name that was not found", async () => {
    mocks.fuzzySearch.mockRejectedValue(new Error("403 Forbidden"));

    const response = await locatePlaceHandler({ query: "Dam Square" });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("403 Forbidden");
    expect(response.content[0].text).not.toContain("Could not locate");
  });
});

describe("discoverPlacesHandler scopes", () => {
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
  const places = { type: "FeatureCollection", features: [] };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchInAreas.mockResolvedValue(places);
    mocks.fuzzySearch.mockResolvedValue(places);
    mocks.searchAlongRoute.mockResolvedValue(places);
  });

  it("searches every resolved area in ONE request, and says where each name resolved", async () => {
    const { resolveWithin } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveWithin).mockResolvedValue(
      ["Jordaan, Amsterdam", "Centrum, Utrecht"].map((label) => ({
        bbox: [4, 52, 5, 53] as [number, number, number, number],
        polygon: square,
        label,
        query: label.split(",")[0],
        source: "query" as const,
      }))
    );

    const response = await discoverPlacesHandler({
      query: "bakery",
      where: { mode: "within", queries: ["Jordaan", "Centrum"] },
    });

    expect(mocks.searchInAreas).toHaveBeenCalledTimes(1);
    expect(mocks.searchInAreas.mock.calls[0][1]).toEqual([square, square]);
    expect(parse(response).searched.resolvedAreas).toMatchObject([
      { query: "Jordaan", matched: "Jordaan, Amsterdam", area: { name: "Jordaan, Amsterdam" } },
      { query: "Centrum", matched: "Centrum, Utrecht", area: { name: "Centrum, Utrecht" } },
    ]);
  });

  it("asks for a subject when neither query nor poiCategories is given", async () => {
    const response = await discoverPlacesHandler({ where: { mode: "global" } } as never);

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("Provide a search subject");
    expect(mocks.fuzzySearch).not.toHaveBeenCalled();
  });

  // Measured: asked for "places near Amsterdam Centraal", models sent no
  // subject, or `["*"]`, were refused, and tried again up to four times.
  it("browses the commonest kinds of place when a scope is given without a subject", async () => {
    const response = await discoverPlacesHandler({
      where: { mode: "nearby", position: [4.9, 52.378] },
    } as never);

    expect(mocks.fuzzySearch).toHaveBeenCalledTimes(1);
    const [query, options] = mocks.fuzzySearch.mock.calls[0];
    expect(query).toBe("");
    expect(options.poiCategories).toEqual(expect.arrayContaining(["RESTAURANT", "CAFE_PUB"]));
    // At most 10 categories a request, which the API allows.
    expect(options.poiCategories.length).toBeLessThanOrEqual(10);
    expect(parse(response).searched.browsed).toContain("commonest kinds of place");
  });

  it("says what to do when no driving route connects a maxDetour search's locations", async () => {
    mocks.getRoute.mockResolvedValue({ type: "FeatureCollection", features: [] });

    const response = await discoverPlacesHandler({
      query: "charger",
      where: {
        mode: "maxDetour",
        locations: [{ position: [4.9, 52.37] }, { position: [-74, 40.7] }],
        maxDetourTimeSeconds: 600,
        sortBy: "detourTime" as const,
      },
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("No driving route connects the locations");
    expect(response.content[0].text).toContain("reachable by road");
    expect(mocks.searchAlongRoute).not.toHaveBeenCalled();
  });

  it("biases a nearby search to the point and radius", async () => {
    const { resolveNearby } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveNearby).mockResolvedValue({ position: [4.9, 52.37], radiusMeters: 500 });

    await discoverPlacesHandler({
      query: "coffee",
      where: { mode: "nearby", query: "Dam Square, Amsterdam", radiusMeters: 500 },
    });

    expect(mocks.fuzzySearch).toHaveBeenCalledWith(
      "coffee",
      expect.objectContaining({ position: [4.9, 52.37], radius: 500 })
    );
  });

  it("plans the trip, then searches along it within the detour budget", async () => {
    const route = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [] },
      properties: { summary: { lengthInMeters: 520_000, travelTimeInSeconds: 18_000 } },
    };
    mocks.getRoute.mockResolvedValue({ type: "FeatureCollection", features: [route] });

    const response = await discoverPlacesHandler({
      poiCategories: ["ELECTRIC_VEHICLE_STATION"],
      where: {
        mode: "maxDetour",
        locations: [{ position: [4.9, 52.37] }, { position: [2.35, 48.86] }],
        maxDetourTimeSeconds: 600,
        sortBy: "detourOffset",
      },
    });

    expect(mocks.getRoute).toHaveBeenCalledWith([
      [4.9, 52.37],
      [2.35, 48.86],
    ]);
    expect(mocks.searchAlongRoute).toHaveBeenCalledWith(
      "",
      route,
      expect.objectContaining({ maxDetourTimeSeconds: 600, sortBy: "detourOffset" })
    );
    expect(parse(response).searched).toMatchObject({
      mode: "maxDetour",
      route: { lengthInMeters: 520_000, travelTimeInSeconds: 18_000 },
      order: "Along the route, from the start.",
    });
  });

  // An eval answer presented the default detour ranking as route order.
  it("says a default maxDetour search is not in route order", async () => {
    mocks.getRoute.mockResolvedValue({
      type: "FeatureCollection",
      features: [{ properties: { summary: { lengthInMeters: 1, travelTimeInSeconds: 1 } } }],
    });

    const response = await discoverPlacesHandler({
      query: "fuel",
      where: {
        mode: "maxDetour",
        locations: [{ position: [4.9, 52.37] }, { position: [2.35, 48.86] }],
        maxDetourTimeSeconds: 600,
        sortBy: "detourTime" as const,
      },
    });

    expect(parse(response).searched.order).toMatch(
      /NOT by where it is along the route.*detourOffset/
    );
  });

  describe("app data", () => {
    const route = {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [4.9, 52.37],
          [2.35, 48.86],
        ],
      },
      properties: { summary: { lengthInMeters: 520_000, travelTimeInSeconds: 18_000 } },
    };
    const routes = { type: "FeatureCollection", features: [route] };
    const maxDetour = {
      mode: "maxDetour" as const,
      locations: [{ position: [4.9, 52.37] }, { position: [2.35, 48.86] }],
      maxDetourTimeSeconds: 600,
      sortBy: "detourTime" as const,
    };
    const appDataOf = (response: Awaited<ReturnType<typeof discoverPlacesHandler>>) =>
      response[APP_DATA]?.data as Record<string, any>;

    it("outlines the one area a within search covered", async () => {
      const { resolveWithin } = await import("../shared/inputs/resolve-where");
      vi.mocked(resolveWithin).mockResolvedValue([
        {
          bbox: [4, 52, 5, 53],
          polygon: square,
          label: "Jordaan",
          query: "Jordaan",
          source: "query",
        },
      ]);

      const data = appDataOf(
        await discoverPlacesHandler({
          query: "bakery",
          where: { mode: "within", queries: ["Jordaan"] },
          show_ui: true,
        })
      );

      expect(data.features).toEqual([]);
      expect(data._searchBoundary).toEqual({
        type: "Feature",
        geometry: square,
        properties: {},
      });
    });

    it("outlines several areas as one MultiPolygon, an area without a boundary by its bounds", async () => {
      const { resolveWithin } = await import("../shared/inputs/resolve-where");
      vi.mocked(resolveWithin).mockResolvedValue([
        {
          bbox: [4, 52, 5, 53],
          polygon: square,
          label: "Jordaan",
          query: "Jordaan",
          source: "query",
        },
        { bbox: [6, 50, 7, 51], source: "boundingBox" },
      ]);

      const data = appDataOf(
        await discoverPlacesHandler({
          query: "bakery",
          where: { mode: "within", queries: ["Jordaan"], boundingBox: [6, 50, 7, 51] },
          show_ui: true,
        })
      );
      const { geometry } = data._searchBoundary;

      expect(geometry.type).toBe("MultiPolygon");
      expect(geometry.coordinates).toHaveLength(2);
      expect(geometry.coordinates[0]).toEqual(square.coordinates);
      expect(geometry.coordinates[1][0]).toEqual(
        expect.arrayContaining([
          [6, 50],
          [7, 51],
        ])
      );
    });

    it("outlines a nearby search as the circle it covered", async () => {
      const { resolveNearby } = await import("../shared/inputs/resolve-where");
      vi.mocked(resolveNearby).mockResolvedValue({ position: [4.9, 52.37], radiusMeters: 500 });

      const data = appDataOf(
        await discoverPlacesHandler({
          query: "coffee",
          where: { mode: "nearby", position: [4.9, 52.37], radiusMeters: 500 },
          show_ui: true,
        })
      );
      const [ring] = data._searchBoundary.geometry.coordinates;

      expect(data._searchBoundary.geometry.type).toBe("Polygon");
      for (const point of [ring[0], ring[Math.floor(ring.length / 2)]]) {
        expect(turf.distance([4.9, 52.37], point, { units: "meters" })).toBeCloseTo(500, -1);
      }
    });

    it("draws a maxDetour search's planned route with the places along it", async () => {
      mocks.getRoute.mockResolvedValue(routes);
      const pois = {
        type: "FeatureCollection",
        features: [{ ...oneFeature("Fastned").features[0] }],
      };
      mocks.searchAlongRoute.mockResolvedValue(pois);

      const data = appDataOf(
        await discoverPlacesHandler({ query: "charger", where: maxDetour, show_ui: true })
      );

      expect(data).toEqual({ route: routes, pois });
    });

    it("says whether each place is open, and leaves its week of hours out of the map's data", async () => {
      const place = oneFeature("Bakkerij").features[0];
      const at = (hour: number) => ({
        date: new Date(Date.UTC(2026, 8, 24, hour)),
        dateYYYYMMDD: "2026-09-24",
        year: 2026,
        month: 9,
        day: 24,
        hour,
        minute: 0,
      });
      const poi = {
        name: "Bakkerij",
        openingHours: {
          mode: "nextSevenDays",
          timeRanges: [{ start: at(0), end: at(23) }],
          alwaysOpenThisPeriod: false,
        },
        timeZone: { ianaId: "UTC" },
      };
      mocks.fuzzySearch.mockResolvedValue({
        type: "FeatureCollection",
        features: [{ ...place, properties: { ...place.properties, poi } }],
      });

      const response = await discoverPlacesHandler({ query: "bakery", show_ui: true });

      const [shown] = parse(response).features;
      expect(shown.properties.poi.openingHours).toHaveProperty("openNow");
      expect(shown.properties.poi).not.toHaveProperty("timeZone");
      const [drawn] = appDataOf(response).features;
      expect(drawn.properties.poi).toEqual({ name: "Bakkerij" });
    });

    it("takes a maxDetour budget in whole seconds only, as the API does", async () => {
      const { tomtomDiscoverPlacesSchema } = await import(
        "../../schemas/search/discoverPlacesSchema"
      );
      const { z } = await import("zod");
      const parse = (maxDetourTimeSeconds: number) =>
        z.object(tomtomDiscoverPlacesSchema).safeParse({
          query: "charger",
          where: { ...maxDetour, maxDetourTimeSeconds },
        }).success;

      expect(parse(450)).toBe(true);
      expect(parse(450.5)).toBe(false);
    });

    it("takes at most 10 categories and 10 connector types, as the Search API does", async () => {
      const { tomtomDiscoverPlacesSchema } = await import(
        "../../schemas/search/discoverPlacesSchema"
      );
      const { z } = await import("zod");
      const parse = (input: Record<string, unknown>) =>
        z.object(tomtomDiscoverPlacesSchema).safeParse(input).success;

      expect(parse({ poiCategories: Array(10).fill("CAFE") })).toBe(true);
      expect(parse({ poiCategories: Array(11).fill("CAFE") })).toBe(false);
      expect(parse({ query: "charger", connectors: Array(11).fill("Chademo") })).toBe(false);
    });

    it("clamps a maxDetour limit to the most the Along Route Search API returns", async () => {
      mocks.getRoute.mockResolvedValue(routes);

      await discoverPlacesHandler({ query: "charger", where: maxDetour, limit: 50 });

      expect(mocks.searchAlongRoute).toHaveBeenCalledWith(
        "charger",
        route,
        expect.objectContaining({ limit: 20 })
      );
    });
  });

  // Measured: gpt-5.1 sent `countries` with a route, was refused, and asked again.
  it("ignores countries with an area, which already says where", async () => {
    const response = await discoverPlacesHandler({
      query: "bakery",
      countries: ["NL"],
      where: { mode: "within", boundingBox: [4, 52, 5, 53] },
    });

    expect(response.isError).toBeFalsy();
    expect(mocks.searchInAreas.mock.calls[0][2]).not.toHaveProperty("countries");
  });

  it("fails loudly when the search breaks", async () => {
    mocks.fuzzySearch.mockRejectedValue(new Error("upstream down"));

    const response = await discoverPlacesHandler({ query: "EV charging" });

    expect(response.isError).toBe(true);
    // "No chargers here" and "the search broke" must never look the same.
    expect(response.content[0].text).toContain("upstream down");
  });
});

describe("locatePlaceHandler boundaries", () => {
  const square = {
    type: "Polygon",
    coordinates: [
      [
        [4.87, 52.37],
        [4.89, 52.37],
        [4.89, 52.39],
        [4.87, 52.37],
      ],
    ],
  };
  const jordaan = (freeformAddress: string) => ({
    type: "Feature",
    id: freeformAddress,
    bbox: [4.87, 52.37, 4.89, 52.39],
    geometry: { type: "Point", coordinates: [4.88, 52.38] },
    properties: {
      type: "Geography",
      address: { freeformAddress },
      dataSources: { geometry: { id: "b-1" } },
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fuzzySearch.mockResolvedValue({
      type: "FeatureCollection",
      features: [oneFeature("Café Jordaan, Amsterdam").features[0], jordaan("Jordaan, Amsterdam")],
    });
    mocks.fetchBoundaries.mockResolvedValue({ features: [{ id: "b-1", geometry: square }] });
  });

  it("returns the area's boundary polygon when geometry is asked for", async () => {
    const response = await locatePlaceHandler({ query: "Jordaan", response_detail: "geometry" });
    const body = parse(response);

    expect(body.located).toBe("Jordaan, Amsterdam");
    expect(body.area).toEqual({
      name: "Jordaan, Amsterdam",
      boundingBox: [4.87, 52.37, 4.89, 52.39],
      boundaryId: "b-1",
    });
    expect(body.geometry.features).toHaveLength(1);
    expect(body.geometry.features[0]).toMatchObject({
      geometry: { type: "Polygon" },
      properties: { place: 0 },
    });
  });

  it("does not fetch boundaries when no geometry is asked for", async () => {
    const response = await locatePlaceHandler({ query: "Jordaan" });

    expect(mocks.fetchBoundaries).not.toHaveBeenCalled();
    expect(parse(response).located).toBe("Café Jordaan, Amsterdam");
    expect(parse(response).features).toHaveLength(1);
  });

  it("says so, and returns the point, when the place has no boundary", async () => {
    mocks.fuzzySearch.mockResolvedValue(oneFeature("Café Jordaan, Amsterdam"));

    const body = parse(
      await locatePlaceHandler({ query: "Café Jordaan", response_detail: "geometry" })
    );

    expect(body.boundaryNote).toContain("no boundary polygon");
    expect(body.geometry.features[0].geometry.type).toBe("Point");
    expect(body.area).toBeUndefined();
  });
});

describe("locatePlaceHandler on recorded answers", () => {
  const recorded = loadFixture("landmarks");

  it.each(LANDMARKS)("$query", async ({ query, at, withinMeters }) => {
    mocks.fuzzySearch.mockReset().mockResolvedValue(recorded[query]);

    const [top] = parse(await locatePlaceHandler({ query })).features;

    expect(mocks.fuzzySearch).toHaveBeenCalledTimes(1);
    expect(turf.distance(top.geometry.coordinates, at, { units: "meters" })).toBeLessThanOrEqual(
      withinMeters
    );
  });
});
