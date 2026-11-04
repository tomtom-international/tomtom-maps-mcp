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
  // The pure helpers are the real ones; only the requests are stubbed.
  ...(await importOriginal<typeof import("../shared/inputs/resolve-where")>()),
  resolveWithin: vi.fn(),
  resolveNearby: vi.fn(),
  describeAreas: vi.fn(() => ""),
}));

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { discoverPlacesHandler } = await import("./discover-places");

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

  it("refuses more polygons than ten requests cover, before any search", async () => {
    const { resolveWithin } = await import("../shared/inputs/resolve-where");
    const box = { bbox: [4.8, 52.3, 4.9, 52.4] as [number, number, number, number] };
    vi.mocked(resolveWithin).mockResolvedValue(
      Array.from({ length: 501 }, () => ({ ...box, source: "dataset", label: "ds polygon" }))
    );

    const response = await discoverPlacesHandler({
      poiCategories: ["RESTAURANT"],
      where: { mode: "within", dataset_ids: ["ds_buffers"] },
    });

    expect(response.isError).toBe(true);
    expect(parse(response).details).toEqual({ polygons: 501, maxPolygons: 500 });
    expect(mocks.searchInAreas).not.toHaveBeenCalled();
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
      matched: 3,
      covers: expect.stringContaining("search again with `limit` 3"),
    });
  });

  it("says a pool the search filled is only a lower bound on what matched", async () => {
    searched(...Array.from({ length: 50 }, (_, index) => place(`cafe ${index}`, [4.9, 52.35])));

    const { summary } = parse(
      await discoverPlacesHandler({
        poiCategories: ["cafe"],
        where: { mode: "within", queries: ["Amsterdam"] },
        limit: 2,
      })
    );

    expect(summary).toMatchObject({
      matched: 50,
      covers: expect.stringContaining("2 of at least 50 places the search matched"),
    });
  });

  it("says more matched when a search with no count of its own fills `limit`", async () => {
    mocks.fuzzySearch.mockResolvedValue({
      type: "FeatureCollection",
      features: [place("a", [4.9, 52.35]), place("b", [4.91, 52.35])],
    });

    const { summary } = parse(await discoverPlacesHandler({ query: "cafe", limit: 2 }));

    expect(summary.covers).toBe(
      "The 2 places returned; more matched. Narrow the scope or raise `limit` (at most 100) for a full count."
    );
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

  it("refuses an unsupported language before any request", async () => {
    const response = await discoverPlacesHandler({
      query: "cafe",
      language: "en-NL",
      where: { mode: "within", queries: ["Amsterdam"] },
    });

    expect(response.isError).toBe(true);
    expect(JSON.parse(response.content[0].text)).toMatchObject({
      error: "The Search API does not support this language. Use one of valid_values.",
      details: { language: "en-NL" },
    });
    const { resolveWithin } = await import("../shared/inputs/resolve-where");
    expect(resolveWithin).not.toHaveBeenCalled();
    expect(mocks.searchInAreas).not.toHaveBeenCalled();
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
    const { resolveNearby } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveNearby).mockResolvedValue({ position: [4.9, 52.378], radiusMeters: 1000 });
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
      order: expect.stringMatching(/^Along the route, from the start\./),
    });
  });

  // An eval answer presented the default detour ranking as route order.
  it("says a default maxDetour search is not in route order", async () => {
    mocks.getRoute.mockResolvedValue({
      type: "FeatureCollection",
      features: [
        {
          geometry: { type: "LineString", coordinates: [] },
          properties: { summary: { lengthInMeters: 1, travelTimeInSeconds: 1 } },
        },
      ],
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

    it("draws a maxDetour search's planned route with the places along it, each placed on it", async () => {
      mocks.getRoute.mockResolvedValue(routes);
      const place = oneFeature("Fastned").features[0];
      mocks.searchAlongRoute.mockResolvedValue({ type: "FeatureCollection", features: [place] });

      const data = appDataOf(
        await discoverPlacesHandler({ query: "charger", where: maxDetour, show_ui: true })
      );

      expect(data.route).toEqual(routes);
      expect(data.pois.features).toEqual([
        {
          ...place,
          properties: {
            ...place.properties,
            alongRoute: {
              meters: expect.any(Number),
              seconds: expect.any(Number),
              offRouteMeters: expect.any(Number),
            },
          },
        },
      ]);
    });

    it("gives a full result, which has no app data, the outline or the route the app draws", async () => {
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
      mocks.getRoute.mockResolvedValue(routes);
      mocks.searchAlongRoute.mockResolvedValue(oneFeature("Fastned"));
      const full = async (where: object) =>
        parse(
          await discoverPlacesHandler({
            query: "charger",
            where: where as never,
            response_detail: "full",
            show_ui: true,
          })
        );

      expect((await full({ mode: "within", queries: ["Jordaan"] }))._searchBoundary).toEqual({
        type: "Feature",
        geometry: square,
        properties: {},
      });
      const alongDrive = await full(maxDetour);
      expect(alongDrive.route).toEqual(routes);
      expect(alongDrive.features).toHaveLength(1);
      const compact = parse(
        await discoverPlacesHandler({ query: "charger", where: maxDetour, show_ui: true })
      );
      expect(compact).not.toHaveProperty("route");
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

describe("route modes", () => {
  /** Ten 10 km steps east, the Netherlands to point 6 and Belgium after; motorway on every odd step. */
  const coordinates: Position[] = Array.from({ length: 11 }, (_, index) => [4 + index * 0.1, 50]);
  const route = {
    type: "Feature",
    geometry: { type: "LineString", coordinates },
    properties: {
      summary: { lengthInMeters: 100_000, travelTimeInSeconds: 3600 },
      progress: [
        { pointIndex: 0, distanceInMeters: 0, travelTimeInSeconds: 0 },
        { pointIndex: 10, distanceInMeters: 100_000, travelTimeInSeconds: 3600 },
      ],
      sections: {
        country: [
          { startPointIndex: 0, endPointIndex: 6, countryCodeISO2: "NL" },
          { startPointIndex: 6, endPointIndex: 10, countryCodeISO2: "BE" },
        ],
        motorway: [1, 3, 5, 7, 9].map((start) => ({
          startPointIndex: start,
          endPointIndex: start + 1,
        })),
      },
    },
  };
  const locations = [{ position: [4, 50] }, { position: [5, 50] }];
  const at = (id: string, position: Position) => ({
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates: position },
    properties: { address: { freeformAddress: id } },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRoute.mockResolvedValue({ type: "FeatureCollection", features: [route] });
  });

  it("searches the corridor of an alongRoute drive in polygons the API takes whole, in driving order", async () => {
    mocks.searchInAreas.mockResolvedValue({
      type: "FeatureCollection",
      features: [at("late", [4.8, 50.002]), at("off", [4.5, 50.05]), at("early", [4.1, 49.999])],
    });

    const response = await discoverPlacesHandler({
      query: "parking",
      where: { mode: "alongRoute", locations, withinMeters: 500 },
    });
    const body = parse(response);

    const [, polygons, options] = mocks.searchInAreas.mock.calls[0];
    for (const polygon of polygons) {
      expect(polygon.coordinates[0].length - 1).toBeLessThanOrEqual(50);
    }
    expect(options.limit).toBe(100);
    expect(body.features.map(({ properties }: any) => properties.address.freeformAddress)).toEqual([
      "early",
      "late",
    ]);
    expect(body.features[0].properties.alongRoute).toEqual({
      meters: expect.closeTo(10_000, -2),
      seconds: expect.closeTo(360, -1),
      offRouteMeters: expect.closeTo(111, -1),
    });
    expect(body.searched).toMatchObject({
      mode: "alongRoute",
      scope: expect.stringContaining("within 500 m of the drive"),
      order: expect.stringContaining("In the order the drive reaches them"),
    });
    expect(body.summary.covers).toBe("Every place the search matched.");
  });

  it("says how far into the drive a search that `limit` cut reaches", async () => {
    mocks.searchInAreas.mockResolvedValue({
      type: "FeatureCollection",
      features: [at("late", [4.8, 50.002]), at("mid", [4.5, 50.001]), at("early", [4.1, 49.999])],
    });

    const body = parse(
      await discoverPlacesHandler({
        query: "parking",
        where: { mode: "alongRoute", locations, withinMeters: 500 },
        limit: 2,
      })
    );

    expect(body.summary.reaches).toContain("they stop 50.0 km into the 100.0 km drive");
    expect(body.summary.reaches).toContain("`stretch` { from: 50000 }");
  });

  it("follows a route an earlier plan-route call stored, with no routing request", async () => {
    const { storeDataset } = await import("../../services/datasets/dataset-store");
    const { id } = storeDataset(
      { type: "FeatureCollection", features: [route] },
      { tool: "tomtom-plan-route", params: {} }
    );
    mocks.searchInAreas.mockResolvedValue({
      type: "FeatureCollection",
      features: [at("belgian", [4.8, 50.002]), at("dutch", [4.1, 49.999])],
    });

    const body = parse(
      await discoverPlacesHandler({
        query: "parking",
        where: { mode: "alongRoute", dataset_id: id, stretch: { includeCountries: ["BE"] } },
      })
    );

    expect(mocks.getRoute).not.toHaveBeenCalled();
    expect(body.features.map(({ properties }: any) => properties.address.freeformAddress)).toEqual([
      "belgian",
    ]);
    expect(body.searched.scope).toBe(`within 1000 m of the route in ${id}`);
  });

  it("runs a detour search along a route an earlier plan-route call stored, as planned", async () => {
    const { storeDataset } = await import("../../services/datasets/dataset-store");
    const { id } = storeDataset(
      { type: "FeatureCollection", features: [route] },
      { tool: "tomtom-plan-route", params: {} }
    );
    mocks.searchAlongRoute.mockResolvedValue({ type: "FeatureCollection", features: [] });

    const body = parse(
      await discoverPlacesHandler({
        query: "fuel",
        where: {
          mode: "maxDetour",
          dataset_id: id,
          maxDetourTimeSeconds: 300,
          sortBy: "detourTime",
        },
      })
    );

    expect(mocks.getRoute).not.toHaveBeenCalled();
    const [[, sent]] = mocks.searchAlongRoute.mock.calls;
    expect(sent).toMatchObject({ geometry: route.geometry });
    expect(body.searched.scope).toBe(`within a 300s detour of the route in ${id}`);
  });

  it("runs a detour search along a derived line by its coordinates", async () => {
    const { storeDataset } = await import("../../services/datasets/dataset-store");
    const { id } = storeDataset(
      {
        type: "FeatureCollection",
        features: [{ type: "Feature", geometry: route.geometry, properties: {} }],
      },
      { tool: "tomtom-derive-datasets", params: {} }
    );
    mocks.searchAlongRoute.mockResolvedValue({ type: "FeatureCollection", features: [] });

    const body = parse(
      await discoverPlacesHandler({
        query: "fuel",
        where: {
          mode: "maxDetour",
          dataset_id: id,
          maxDetourTimeSeconds: 300,
          sortBy: "detourTime",
        },
      })
    );

    expect(mocks.getRoute).not.toHaveBeenCalled();
    expect(mocks.searchAlongRoute.mock.calls[0][1]).toEqual(coordinates);
    expect(body.searched.scope).toBe(`within a 300s detour of the line in ${id}`);
  });

  it("searches only the stretch asked for, and lists it", async () => {
    mocks.searchInAreas.mockResolvedValue({ type: "FeatureCollection", features: [] });

    const body = parse(
      await discoverPlacesHandler({
        query: "parking",
        where: { mode: "alongRoute", locations, stretch: { includeCountries: ["BE"] } },
      })
    );

    for (const polygon of mocks.searchInAreas.mock.calls[0][1]) {
      const [west, , east] = turf.bbox(polygon);
      expect(west).toBeGreaterThan(4.55);
      expect(east).toBeLessThan(5.05);
    }
    expect(body.searched.stretch).toEqual({
      stretches: [{ fromMeters: 60_000, toMeters: 100_000 }],
      searchedMeters: 40_000,
      routeMeters: 100_000,
    });
  });

  it("runs a detour search on each stretch, measuring offsets from the start of the drive", async () => {
    mocks.searchAlongRoute.mockImplementation(async (_query: string, line: Position[]) => ({
      type: "FeatureCollection",
      features: [
        {
          ...at(`stop at ${line[0][0].toFixed(1)}`, line[0]),
          properties: { detourTimeInSeconds: 60, detourOffsetInMeters: 500 },
        },
      ],
    }));

    const body = parse(
      await discoverPlacesHandler({
        query: "fuel",
        where: {
          mode: "maxDetour",
          locations,
          maxDetourTimeSeconds: 300,
          sortBy: "detourOffset",
          stretch: { from: 15_000, to: 45_000, excludeSections: ["motorway"] },
        },
      })
    );

    expect(mocks.searchAlongRoute.mock.calls.map(([, line]) => line[0][0])).toEqual(
      [4.2, 4.4].map((lon) => expect.closeTo(lon, 6))
    );
    expect(body.features.map(({ properties }: any) => properties.detourOffsetInMeters)).toEqual([
      20_500, 40_500,
    ]);
  });

  it("counts every place a corridor search found, past the most `limit` can ask for", async () => {
    const along = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, index) =>
        at(`${prefix} ${index}`, [4.05 + (index / count) * 0.9, 50.001])
      );
    mocks.searchInAreas
      .mockResolvedValueOnce({ type: "FeatureCollection", features: along("whole", 100) })
      .mockResolvedValueOnce({ type: "FeatureCollection", features: along("first half", 60) })
      .mockResolvedValueOnce({ type: "FeatureCollection", features: along("second half", 60) });

    const { summary } = parse(
      await discoverPlacesHandler({
        query: "parking",
        where: { mode: "alongRoute", locations, withinMeters: 500 },
        limit: 100,
      })
    );

    expect(summary).toMatchObject({
      places: 100,
      matched: 220,
      covers:
        "100 of the 220 places the search matched. For more, raise `limit` (at most 100), or up to " +
        "1000 with response_detail 'dataset', and narrow the scope.",
    });
  });

  describe("maxDetour stretches cut at the most one search returns", () => {
    const twoStretches = {
      mode: "maxDetour" as const,
      locations,
      maxDetourTimeSeconds: 300,
      sortBy: "detourOffset" as const,
      stretch: { from: 15_000, to: 45_000, excludeSections: ["motorway" as const] },
    };
    /** The places a detour search finds along `line`: 20 on the first stretch, the most it returns. */
    const stopsAlong = async (_query: string, line: Position[]) => ({
      type: "FeatureCollection",
      features: Array.from({ length: line[0][0] < 4.3 ? 20 : 3 }, (_, index) => {
        const name = `stop ${line[0][0].toFixed(1)}-${index}`;
        return {
          ...at(name, [line[0][0] + index * 0.004, 50]),
          properties: {
            address: { freeformAddress: name },
            detourTimeInSeconds: 60,
            detourOffsetInMeters: index * 400,
          },
        };
      }),
    });

    it("stops a route-order list at the end of the first stretch the search cut", async () => {
      mocks.searchAlongRoute.mockImplementation(stopsAlong);

      const body = parse(
        await discoverPlacesHandler({ query: "fuel", where: twoStretches, limit: 30 })
      );

      const names: string[] = body.features.map(
        ({ properties }: any) => properties.address.freeformAddress
      );
      expect(names).toHaveLength(20);
      expect(names.every((name) => name.startsWith("stop 4.2-"))).toBe(true);
      expect(body.summary.reaches).toContain("`stretch` { from: ");
    });

    it("names a narrower stretch or alongRoute, not a higher `limit`, once a stretch returns its most", async () => {
      mocks.searchAlongRoute.mockImplementation(stopsAlong);

      const { summary } = parse(
        await discoverPlacesHandler({ query: "fuel", where: twoStretches, limit: 30 })
      );

      expect(summary.covers).toContain("at most 20 places per stretch");
      expect(summary.covers).toContain('use mode "alongRoute"');
      expect(summary.covers).not.toContain("raise `limit`");
      expect(summary.reaches).not.toContain("raise `limit`");
    });
  });

  it("sends a detour search split into many stretches to alongRoute", async () => {
    const steps = Array.from({ length: 22 }, (_, index) => [4 + index * 0.05, 50]);
    mocks.getRoute.mockResolvedValue({
      type: "FeatureCollection",
      features: [
        {
          ...route,
          geometry: { type: "LineString", coordinates: steps },
          properties: {
            ...route.properties,
            progress: [],
            sections: {
              motorway: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19].map((start) => ({
                startPointIndex: start,
                endPointIndex: start + 1,
              })),
            },
          },
        },
      ],
    });

    const response = await discoverPlacesHandler({
      query: "fuel",
      where: {
        mode: "maxDetour",
        locations,
        maxDetourTimeSeconds: 300,
        sortBy: "detourTime",
        stretch: { excludeSections: ["motorway"] },
      },
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("more separate parts of the drive");
    expect(parse(response).details).toMatchObject({ maxStretches: 10 });
    expect(parse(response).details.stretch.stretches).toHaveLength(11);
    expect(mocks.searchAlongRoute).not.toHaveBeenCalled();
  });

  it("takes a limit above one page only for an alongRoute search kept as a dataset", async () => {
    mocks.searchInAreas.mockResolvedValue({ type: "FeatureCollection", features: [] });

    const page = await discoverPlacesHandler({
      query: "fuel",
      where: { mode: "alongRoute", locations },
      limit: 500,
    });
    const dataset = await discoverPlacesHandler({
      query: "fuel",
      where: { mode: "alongRoute", locations },
      limit: 500,
      response_detail: "dataset",
    });

    expect(page.isError).toBe(true);
    expect(parse(page).details).toEqual({ limit: 500, maxLimit: 100 });
    expect(dataset.isError).toBeFalsy();
  });
});

describe("nearby: around each point of a dataset", () => {
  const point = (id: string, position: Position, name?: string) => ({
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates: position },
    properties: { address: { freeformAddress: id }, ...(name && { poi: { name } }) },
  });
  /** About 100 m east of a point at latitude 52. */
  const east = ([lon, lat]: Position, meters: number): Position => [
    lon + meters / (111_320 * Math.cos((lat * Math.PI) / 180)),
    lat,
  ];

  beforeEach(() => vi.clearAllMocks());

  it("searches around only the place tomtom-locate-place located, not its runners-up", async () => {
    const { storeDataset } = await import("../../services/datasets/dataset-store");
    const { id } = storeDataset(
      {
        type: "FeatureCollection",
        features: [point("rijksmuseum", [4.885, 52.36]), point("runner-up", [5.1, 52.1])],
      },
      { tool: "tomtom-locate-place", params: {} }
    );
    const { resolveNearby } = vi.mocked(await import("../shared/inputs/resolve-where"));
    resolveNearby.mockResolvedValue({ position: [4.885, 52.36], radiusMeters: 500 });
    mocks.fuzzySearch.mockResolvedValue({ type: "FeatureCollection", features: [] });

    await discoverPlacesHandler({
      poiCategories: ["cafe"],
      where: { mode: "nearby", dataset_id: id, radiusMeters: 500 },
    });

    expect(mocks.searchInAreas).not.toHaveBeenCalled();
    expect(resolveNearby).toHaveBeenCalledWith(expect.objectContaining({ dataset_id: id }));
    expect(mocks.fuzzySearch).toHaveBeenCalledWith(
      "",
      expect.objectContaining({ position: [4.885, 52.36], radius: 500 })
    );
  });

  it("searches a circle round each point, saying which each place is nearest and counting per point", async () => {
    const { storeDataset } = await import("../../services/datasets/dataset-store");
    const [a, b] = [[4.9, 52.0] as Position, [5.0, 52.0] as Position];
    const { id } = storeDataset(
      {
        type: "FeatureCollection",
        features: [point("a", a, "Charger A"), point("b", b, "Charger B")],
      },
      { tool: "tomtom-discover-places", params: {} }
    );
    mocks.searchInAreas.mockResolvedValue({
      type: "FeatureCollection",
      features: [
        point("near b", east(b, 50)),
        point("near a", east(a, 150)),
        point("also b", east(b, 120)),
        point("too far", east(a, 400)),
      ],
    });

    const body = parse(
      await discoverPlacesHandler({
        poiCategories: ["restaurant"],
        where: { mode: "nearby", dataset_id: id, radiusMeters: 200 },
      })
    );

    const [, circles] = mocks.searchInAreas.mock.calls[0];
    expect(circles).toHaveLength(2);
    expect(
      vi.mocked(await import("../shared/inputs/resolve-where")).resolveNearby
    ).not.toHaveBeenCalled();
    expect(body.features.map(({ properties }: any) => properties.address.freeformAddress)).toEqual([
      "near b",
      "also b",
      "near a",
    ]);
    expect(body.features[0].properties.around).toEqual({ featureIndex: 1, meters: 50 });
    expect(body.searched.perPoint).toEqual([
      { featureIndex: 1, name: "Charger B", places: 2 },
      { featureIndex: 0, name: "Charger A", places: 1 },
    ]);
  });
});
