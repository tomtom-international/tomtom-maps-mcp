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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_DATA } from "../shared/app-data";

const mockGetRoute = vi.fn();
const mockGetTrafficIncidents = vi.fn();
const mockGeocode = vi.fn();
const mockFetchBoundaries = vi.fn();
const mockFuzzySearch = vi.fn();
const mockReverseGeocode = vi.fn();

vi.mock("../../services/routing/routingService", () => ({
  getRoute: mockGetRoute,
}));
vi.mock("../../services/traffic/trafficService", () => ({
  getTrafficIncidents: mockGetTrafficIncidents,
}));
vi.mock("../../services/search/searchService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/search/searchService")>()),
  geocodeAreas: mockGeocode,
  fetchBoundaries: mockFetchBoundaries,
  fuzzySearch: mockFuzzySearch,
  reverseGeocode: mockReverseGeocode,
}));
vi.mock("../../services/api-key", () => ({ getEffectiveApiKey: () => "key-test" }));
vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { planRouteHandler, getTrafficHandler } = await import("./plan-route");
const { tomtomGetTrafficSchema } = await import("../../schemas/traffic/trafficSchema");
const { z } = await import("zod");

const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

const point = (lng: number, lat: number, name?: string) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lng, lat] },
  properties: name ? { poi: { name } } : {},
});

const route = () => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [4.9, 52.37],
          [13.4, 52.52],
        ],
      },
      properties: {
        summary: { lengthInMeters: 654_000, travelTimeInSeconds: 23_400 },
        sections: { leg: [] },
        progress: [
          { pointIndex: 0, distanceInMeters: 0, travelTimeInSeconds: 0 },
          { pointIndex: 1, distanceInMeters: 654_000, travelTimeInSeconds: 23_400 },
        ],
      },
    },
  ],
});

beforeEach(() => vi.clearAllMocks());

describe("planRouteHandler", () => {
  it("resolves place NAMES without a separate geocode call from the model", async () => {
    mockFuzzySearch
      .mockResolvedValueOnce({ features: [point(4.9, 52.378, "Amsterdam Centraal")] })
      .mockResolvedValueOnce({ features: [point(4.885, 52.36, "Rijksmuseum")] });
    mockGetRoute.mockResolvedValue(route());

    const body = parse(
      await planRouteHandler({
        locations: [{ query: "Amsterdam Centraal" }, { query: "Rijksmuseum" }],
      })
    );

    // The hop the locationInput union removes: one tool call, not three.
    expect(mockGetRoute).toHaveBeenCalledWith(
      [
        [4.9, 52.378],
        [4.885, 52.36],
      ],
      expect.anything(),
      { guidance: true }
    );
    // Echoing where each waypoint landed is how a mis-resolved name is
    // distinguishable from a bad route.
    expect(body.waypoints.map((w: { name: string }) => w.name)).toEqual([
      "Amsterdam Centraal",
      "Rijksmuseum",
    ]);
  });

  // With `curvature` and no note, a model asked "how many turns?" counted bends as turns.
  it("says turns are counted in guidance, not curvature, and where the route line is", async () => {
    mockGetRoute.mockResolvedValue(route());
    const locations = [{ position: [1, 2] }, { position: [3, 4] }];
    const noteOf = async (response_detail?: "full", directions?: boolean) =>
      parse(await planRouteHandler({ locations, response_detail, directions })).note;

    expect(await noteOf()).toMatch(
      /`guidance` counts.*directions: true.*response_detail "geometry"/
    );
    // A full result has the API's raw guidance and no curvature, so no note describes them.
    expect(await noteOf("full")).toBeUndefined();
    expect(await noteOf(undefined, true)).not.toMatch(/directions: true/);
  });

  it("lists the first route's steps when asked, and keeps the guidance out of the map's data", async () => {
    const guided = route();
    Object.assign(guided.features[0].properties, {
      guidance: {
        instructions: [
          { routeOffsetInMeters: 0, maneuver: "DEPART", message: "Start driving." },
          { routeOffsetInMeters: 654_000, maneuver: "ARRIVE", message: "You have arrived." },
        ],
      },
    });
    mockGetRoute.mockResolvedValue(guided);
    const locations = [{ position: [1, 2] }, { position: [3, 4] }];

    const response = await planRouteHandler({ locations, directions: true, show_ui: true });

    expect(parse(response).directions).toEqual({
      steps: [
        { startsAfterMeters: 0, maneuver: "DEPART", instruction: "Start driving." },
        { startsAfterMeters: 654_000, maneuver: "ARRIVE", instruction: "You have arrived." },
      ],
      truncated: false,
    });
    expect(parse(response).features[0].properties.guidance).toEqual({
      manoeuvreCount: 0,
      turnCount: 0,
    });
    const mapData = response[APP_DATA]?.data as ReturnType<typeof route> | undefined;
    expect(mapData?.features[0].properties).not.toHaveProperty("guidance");
    expect(parse(await planRouteHandler({ locations }))).not.toHaveProperty("directions");
  });

  it("accepts explicit coordinates unchanged", async () => {
    mockGetRoute.mockResolvedValue(route());
    await planRouteHandler({ locations: [{ position: [1, 2] }, { position: [3, 4] }] });
    expect(mockGetRoute).toHaveBeenCalledWith(
      [
        [1, 2],
        [3, 4],
      ],
      expect.anything(),
      { guidance: true }
    );
    expect(mockFuzzySearch).not.toHaveBeenCalled();
  });

  it("names which location failed to resolve", async () => {
    mockFuzzySearch
      .mockResolvedValueOnce({ features: [point(1, 1, "ok")] })
      .mockResolvedValueOnce({ features: [] });

    const result = await planRouteHandler({
      locations: [{ query: "a" }, { query: "nowhere-at-all" }],
    });

    expect(result.isError).toBe(true);
    expect(parse(result).details.failedInput).toBe("location 2 of 2");
    expect(mockGetRoute).not.toHaveBeenCalled();
  });

  it("slots insertStops in along the route, whatever order they come in", async () => {
    mockGetRoute.mockResolvedValue(route());
    const body = parse(
      await planRouteHandler({
        locations: [{ position: [4.9, 52.37] }, { position: [13.4, 52.52] }],
        insertStops: [{ position: [10, 52.47] }, { position: [7, 52.42] }],
        maxAlternatives: 2,
      })
    );

    expect(mockGetRoute).toHaveBeenNthCalledWith(
      1,
      [
        [4.9, 52.37],
        [13.4, 52.52],
      ],
      {}
    );
    expect(mockGetRoute).toHaveBeenNthCalledWith(
      2,
      [
        [4.9, 52.37],
        [7, 52.42],
        [10, 52.47],
        [13.4, 52.52],
      ],
      { maxAlternatives: 2 },
      { guidance: true }
    );
    expect(body.waypoints.map((w: { inserted?: true }) => w.inserted ?? false)).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  // The eval prompt "stops in Eindhoven, Utrecht and Den Bosch on the way from
  // Amsterdam to Maastricht: in what order?" sent the stops in both fields.
  it("visits a stop named in both locations and insertStops once, where it costs least", async () => {
    mockGetRoute.mockResolvedValue(route());
    const stop = (query: string) => ({ query });
    mockFuzzySearch.mockImplementation(async (query: string) => ({
      features: [point(query.length, 52, query)],
    }));

    const body = parse(
      await planRouteHandler({
        locations: [stop("Amsterdam"), stop("Den Bosch"), stop("Utrecht"), stop("Maastricht")],
        insertStops: [stop("utrecht"), stop("Den Bosch"), stop("Den Bosch")],
      })
    );

    expect(mockFuzzySearch.mock.calls.map(([query]) => query)).toEqual([
      "Amsterdam",
      "Maastricht",
      "utrecht",
      "Den Bosch",
    ]);
    expect(mockGetRoute.mock.calls[0][0]).toHaveLength(2);
    expect(body.waypoints).toHaveLength(4);
  });

  it("rejects an insertStops entry that is the origin or the destination", async () => {
    const result = await planRouteHandler({
      locations: [{ position: [1, 2] }, { position: [3, 4] }],
      insertStops: [{ position: [3, 4] }],
    });

    expect(result.isError).toBe(true);
    expect(parse(result).details.entries).toEqual(["3, 4"]);
    expect(mockGetRoute).not.toHaveBeenCalled();
  });

  it("resolves a round trip's repeated place once and keeps both ends", async () => {
    mockGetRoute.mockResolvedValue(route());
    mockFuzzySearch.mockImplementation(async (query: string) => ({
      features: [point(query.length, 52, query)],
    }));

    const body = parse(
      await planRouteHandler({
        locations: [{ query: "Dam" }, { query: "Zaanse Schans" }, { query: "Dam" }],
        insertStops: [{ query: "Volendam" }],
      })
    );

    expect(mockFuzzySearch).toHaveBeenCalledTimes(3);
    expect(body.waypoints.map((w: { name: string }) => w.name)).toEqual([
      "Dam",
      expect.any(String),
      expect.any(String),
      "Dam",
    ]);
  });

  it("plans the usual-traffic route beside the live one for compareWithUsualRoute", async () => {
    mockGetRoute.mockResolvedValue(route());
    const body = parse(
      await planRouteHandler({
        locations: [{ position: [4.9, 52.37] }, { position: [13.4, 52.52] }],
        compareWithUsualRoute: true,
      })
    );

    expect(mockGetRoute).toHaveBeenCalledWith(expect.anything(), {
      traffic: "historical",
      maxAlternatives: 0,
    });
    expect(body.usualRoute).toMatchObject({ sameRoads: true, avoidedIncidents: [] });
  });

  it("names the town at each checkpoint, and says when the route ends first", async () => {
    mockGetRoute.mockResolvedValue(route());
    mockReverseGeocode.mockResolvedValue({
      properties: { address: { municipality: "Hengelo", country: "Netherlands" } },
    });
    const body = parse(
      await planRouteHandler({
        locations: [{ position: [4.9, 52.37] }, { position: [13.4, 52.52] }],
        checkpoints: [{ afterMinutes: 60 }, { afterKilometers: 1000 }],
      })
    );

    expect(body.checkpoints).toEqual([
      expect.objectContaining({ afterMinutes: 60, near: "Hengelo, Netherlands" }),
      { afterKilometers: 1000, beyondRouteEnd: true },
    ]);
    expect(mockReverseGeocode).toHaveBeenCalledTimes(1);
  });

  it("keeps the route when the town at a checkpoint cannot be looked up", async () => {
    mockGetRoute.mockResolvedValue(route());
    mockReverseGeocode.mockRejectedValue(new Error("429 Too Many Requests"));
    const response = await planRouteHandler({
      locations: [{ position: [4.9, 52.37] }, { position: [13.4, 52.52] }],
      checkpoints: [{ afterMinutes: 60 }],
    });

    expect(response.isError).toBeFalsy();
    const [checkpoint] = parse(response).checkpoints;
    expect(checkpoint).toMatchObject({ afterMinutes: 60 });
    expect(checkpoint).not.toHaveProperty("near");
  });
});

describe("getTrafficHandler", () => {
  const MAGNITUDES = ["unknown", "minor", "moderate", "major"];
  const incidents = (n: number) => ({
    type: "FeatureCollection",
    features: Array.from({ length: n }, (_, i) => ({
      type: "Feature",
      id: `incident-${i}`,
      geometry: { type: "Point", coordinates: [4.9, 52.37] },
      properties: {
        category: "jam",
        magnitudeOfDelay: MAGNITUDES[i % 4],
        roadNumbers: ["A10"],
        delayInSeconds: 60,
        events: [],
      },
    })),
  });

  // The API answers an oversized area with a bare "Bad request", which tells an
  // agent nothing. A long route's span is the usual way to get there, and the
  // route already knows its own delays.
  it("explains an area over the traffic API cap instead of failing opaquely", async () => {
    mockGeocode.mockResolvedValue({
      features: [
        {
          type: "Feature",
          // Roughly Amsterdam to Berlin: about 130,000 km².
          bbox: [4.0, 51.8, 14.0, 53.0],
          geometry: { type: "Point" },
          properties: { address: { freeformAddress: "somewhere large" } },
        },
      ],
    });

    const response = await getTrafficHandler({
      where: { mode: "within", queries: ["somewhere large"] },
    } as never);

    expect(response.isError).toBe(true);
    expect(parse(response).details).toMatchObject({ maxAreaKm2: 10_000 });
    // The way out has to be named, not left as an exercise.
    expect(response.content[0].text).toMatch(/smaller area|boundingBox/);
    expect(mockGetTrafficIncidents).not.toHaveBeenCalled();
  });

  it("resolves an area NAME to bounds without a separate geocode call", async () => {
    mockGeocode.mockResolvedValue({
      features: [
        {
          type: "Feature",
          bbox: [4.7, 52.3, 5.0, 52.4],
          geometry: { type: "Point" },
          properties: { address: { freeformAddress: "Amsterdam" } },
        },
      ],
    });
    mockGetTrafficIncidents.mockResolvedValue(incidents(3));

    const response = await getTrafficHandler({
      where: { mode: "within", queries: ["Amsterdam"] },
      show_ui: true,
    });
    const body = parse(response);

    expect(mockGetTrafficIncidents).toHaveBeenCalledWith([4.7, 52.3, 5.0, 52.4], expect.anything());
    expect(body.searched.scope).toContain("Amsterdam");
    // The map app frames the resolved area, which its own input never names.
    expect(response[APP_DATA]?.data).toEqual({ bbox: [4.7, 52.3, 5.0, 52.4] });
  });

  it("confines a named area's incidents to its boundary", async () => {
    const boundary = {
      type: "Polygon",
      coordinates: [
        [
          [4.8, 52.33],
          [4.95, 52.33],
          [4.95, 52.4],
          [4.8, 52.33],
        ],
      ],
    };
    mockGeocode.mockResolvedValue({
      features: [
        {
          type: "Feature",
          bbox: [4.8, 52.33, 4.95, 52.4],
          geometry: { type: "Point" },
          properties: {
            address: { freeformAddress: "Amsterdam-Centrum" },
            dataSources: { geometry: { id: "b-1" } },
          },
        },
      ],
    });
    mockFetchBoundaries.mockResolvedValue({ features: [{ id: "b-1", geometry: boundary }] });
    mockGetTrafficIncidents.mockResolvedValue(incidents(1));

    const body = parse(
      await getTrafficHandler({ where: { mode: "within", queries: ["Amsterdam-Centrum"] } })
    );

    expect(mockGetTrafficIncidents).toHaveBeenCalledWith(boundary, expect.anything());
    expect(body.searched.scope).toBe("Amsterdam-Centrum");
  });

  it("warns loudly when the visible list is a sample", async () => {
    mockGeocode.mockResolvedValue({
      features: [
        { type: "Feature", bbox: [4, 52, 5, 53], geometry: { type: "Point" }, properties: {} },
      ],
    });
    mockGetTrafficIncidents.mockResolvedValue(incidents(500));

    const body = parse(
      await getTrafficHandler({ where: { mode: "within", queries: ["Amsterdam"] }, maxResults: 10 })
    );

    // Computing a total from a truncated list is the exact fabrication the
    // capability benchmark measures; the response has to say so.
    expect(body.incidentSummary).toMatchObject({ totalIncidents: 500, returnedIncidents: 10 });
    expect(body.incidentSummary.note).toContain("10 most severe of 500");
    expect(body.incidentSummary.note).toContain("Narrow the area");
    // …but it must also say what the visible rows CAN answer. The cap keeps the
    // most severe rather than an arbitrary slice, and a note that said only
    // "it is a sample" had the agent refuse to name the worst incident at all.
    expect(body.incidentSummary.note).toMatch(/ranking questions/i);
    expect(body.incidentSummary.note).toContain("per-road counts above cover all 500");
  });

  describe("alongRoute", () => {
    const amsterdamToBerlin = {
      mode: "alongRoute" as const,
      locations: [{ position: [4.9, 52.37] }, { position: [13.4, 52.52] }],
    };

    it("covers a long drive in corridor pieces each within the area cap, counting repeats once", async () => {
      mockGetRoute.mockResolvedValue(route());
      mockGetTrafficIncidents.mockResolvedValue(incidents(3));

      const body = parse(await getTrafficHandler({ where: amsterdamToBerlin }));

      const areas = mockGetTrafficIncidents.mock.calls.map(([area]) => area);
      expect(areas.length).toBeGreaterThan(1);
      for (const area of areas) {
        expect(area.type).toBe("Polygon");
        const [west, south, east, north] = turf.bbox(area);
        const widthKm = (east - west) * 111.32 * Math.cos((((south + north) / 2) * Math.PI) / 180);
        expect(widthKm * (north - south) * 110.57).toBeLessThanOrEqual(10_000);
      }
      expect(body.incidentSummary.totalIncidents).toBe(3);
      expect(body.searched).toMatchObject({
        mode: "alongRoute",
        scope: expect.stringContaining("within 1000 m of the drive"),
        route: { lengthInMeters: 654_000, travelTimeInSeconds: 23_400 },
      });
    });

    it("lists the incidents in the order the drive meets them, with how far along each starts", async () => {
      mockGetRoute.mockResolvedValue(route());
      const [atAmsterdam, atBerlin] = incidents(2).features;
      atBerlin.geometry.coordinates = [13.4, 52.52];
      atBerlin.properties.roadNumbers = ["A100"];
      mockGetTrafficIncidents.mockResolvedValue({
        type: "FeatureCollection",
        features: [atBerlin, atAmsterdam],
      });

      const body = parse(await getTrafficHandler({ where: amsterdamToBerlin }));

      expect(
        body.incidents.map((incident: { startsAfterMeters: number; roadNumbers: string[] }) => [
          incident.startsAfterMeters,
          incident.roadNumbers,
        ])
      ).toEqual([
        [0, ["A10"]],
        [654_000, ["A100"]],
      ]);
    });

    it("numbers the geometry features in the same driving order as the incidents", async () => {
      mockGetRoute.mockResolvedValue(route());
      const [atAmsterdam, atBerlin] = incidents(2).features;
      atBerlin.geometry.coordinates = [13.4, 52.52];
      mockGetTrafficIncidents.mockResolvedValue({
        type: "FeatureCollection",
        features: [atBerlin, atAmsterdam],
      });

      const body = parse(
        await getTrafficHandler({ where: amsterdamToBerlin, response_detail: "geometry" })
      );

      const berlin = body.geometry.features.find(
        (feature: { geometry: { coordinates: number[] } }) =>
          feature.geometry.coordinates[0] === 13.4
      );
      expect(berlin.properties.incident).toBe(1);
      expect(body.incidents[1].startsAfterMeters).toBe(654_000);
    });

    it("buffers the route by withinMeters", async () => {
      mockGetRoute.mockResolvedValue(route());
      mockGetTrafficIncidents.mockResolvedValue(incidents(0));

      await getTrafficHandler({ where: { ...amsterdamToBerlin, withinMeters: 300 } });

      const [first] = mockGetTrafficIncidents.mock.calls[0];
      const metersFromStart = turf.distance([4.9, 52.37], turf.bbox(first).slice(0, 2), {
        units: "meters",
      });
      expect(metersFromStart).toBeGreaterThan(250);
      expect(metersFromStart).toBeLessThan(600);
    });

    it("says no route connects the locations rather than querying nothing", async () => {
      mockGetRoute.mockResolvedValue({ type: "FeatureCollection", features: [] });

      const response = await getTrafficHandler({ where: amsterdamToBerlin });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("No driving route connects the locations");
      expect(mockGetTrafficIncidents).not.toHaveBeenCalled();
    });

    it("rejects a corridor wider than 5000 m", () => {
      const schema = z.object(tomtomGetTrafficSchema);
      expect(
        schema.safeParse({ where: { ...amsterdamToBerlin, withinMeters: 6000 } }).success
      ).toBe(false);
    });
  });

  it("queries a circle of the radius around a point for nearby mode", async () => {
    mockGetTrafficIncidents.mockResolvedValue(incidents(1));
    await getTrafficHandler({
      where: { mode: "nearby", position: [4.9, 52.37], radiusMeters: 2000 },
    });
    const [circle] = mockGetTrafficIncidents.mock.calls[0];
    expect(circle.type).toBe("Polygon");
    const longitudes = circle.coordinates[0].map(([longitude]: number[]) => longitude);
    expect(Math.min(...longitudes)).toBeLessThan(4.9);
    expect(Math.max(...longitudes)).toBeGreaterThan(4.9);
  });

  it("rejects a nearby scope with neither a position nor a query", async () => {
    const response = await getTrafficHandler({ where: { mode: "nearby", radiusMeters: 2000 } });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/needs `position`.*or `query`/);
    expect(mockGetTrafficIncidents).not.toHaveBeenCalled();
  });

  it("names radiusMeters when a nearby circle exceeds the cap", async () => {
    const response = await getTrafficHandler({
      where: { mode: "nearby", position: [4.9, 52.37], radiusMeters: 100_000 },
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("radiusMeters");
    expect(mockGetTrafficIncidents).not.toHaveBeenCalled();
  });

  it("offers no global mode: traffic everywhere is not a query", () => {
    const parsed = z.object(tomtomGetTrafficSchema).safeParse({ where: { mode: "global" } });
    expect(parsed.success).toBe(false);
  });

  // A count over one of several areas, reported as the whole scope's, is the
  // quiet partial answer these guard against.
  describe("several resolved areas", () => {
    const city = (name: string, bbox: number[]) => ({
      features: [
        {
          type: "Feature",
          bbox,
          geometry: { type: "Point" },
          properties: { address: { freeformAddress: name } },
        },
      ],
    });

    const twoCities = () => {
      mockGeocode
        .mockResolvedValueOnce(city("Amsterdam", [4.7, 52.3, 5.0, 52.4]))
        .mockResolvedValueOnce(city("Rotterdam", [4.4, 51.9, 4.6, 52.0]));
    };

    const withId = (id: string) => ({
      type: "Feature",
      id,
      geometry: { type: "Point", coordinates: [4.9, 52.37] },
      properties: {
        category: "jam",
        magnitudeOfDelay: "major",
        roadNumbers: ["A10"],
        delayInSeconds: 60,
        events: [],
      },
    });

    const both = { mode: "within", queries: ["Amsterdam", "Rotterdam"] };

    it("queries every resolved area, not just the first", async () => {
      twoCities();
      mockGetTrafficIncidents
        .mockResolvedValueOnce({ type: "FeatureCollection", features: [withId("a"), withId("b")] })
        .mockResolvedValueOnce({ type: "FeatureCollection", features: [withId("c")] });

      const body = parse(await getTrafficHandler({ where: both } as never));

      expect(mockGetTrafficIncidents).toHaveBeenCalledTimes(2);
      expect(mockGetTrafficIncidents.mock.calls.map(([bbox]) => bbox)).toEqual([
        [4.7, 52.3, 5.0, 52.4],
        [4.4, 51.9, 4.6, 52.0],
      ]);
      expect(body.searched.areasQueried).toBe(2);
      expect(body.incidents).toHaveLength(3);
      expect(body.searched.resolvedAreas).toMatchObject([
        { query: "Amsterdam", matched: "Amsterdam", area: { boundingBox: [4.7, 52.3, 5, 52.4] } },
        { query: "Rotterdam", matched: "Rotterdam", area: { name: "Rotterdam" } },
      ]);
    });

    it("counts an incident found in two overlapping areas once", async () => {
      twoCities();
      mockGetTrafficIncidents
        .mockResolvedValueOnce({
          type: "FeatureCollection",
          features: [withId("shared"), withId("a")],
        })
        .mockResolvedValueOnce({ type: "FeatureCollection", features: [withId("shared")] });

      const body = parse(await getTrafficHandler({ where: both } as never));

      // Three rows, two incidents. Counting the repeat would make "how many
      // hold-ups" a question about geometry rather than traffic.
      expect(body.incidents).toHaveLength(2);
      expect(body.searched.duplicatesMerged).toBe(1);
      expect(body.searched.duplicatesNote).toContain("counted once");
    });

    it("returns the areas that worked, and says how many did not", async () => {
      twoCities();
      mockGetTrafficIncidents
        .mockResolvedValueOnce({ type: "FeatureCollection", features: [withId("a")] })
        .mockRejectedValueOnce(new Error("upstream exploded"));

      const body = parse(await getTrafficHandler({ where: both } as never));

      expect(body.incidents).toHaveLength(1);
      // A lower bound presented as a total is the fabrication being designed out.
      expect(body.searched.note).toContain("could not be queried");
      expect(body.searched.note).toContain("lower bound");
    });

    it("fails when every area fails, rather than reporting an empty result", async () => {
      twoCities();
      mockGetTrafficIncidents.mockRejectedValue(new Error("upstream exploded"));

      const response = await getTrafficHandler({ where: both } as never);

      // Zero incidents because nothing was found is a different answer from zero
      // incidents because every request failed.
      expect(response.isError).toBe(true);
      expect(parse(response).error).toBeTruthy();
    });

    it("skips an area over the cap and queries the rest, saying so", async () => {
      mockGeocode
        .mockResolvedValueOnce(city("Amsterdam", [4.7, 52.3, 5.0, 52.4]))
        // ~130,000 km², well past the 10,000 km² cap.
        .mockResolvedValueOnce(city("somewhere large", [4.0, 51.8, 14.0, 53.0]));
      mockGetTrafficIncidents.mockResolvedValue({
        type: "FeatureCollection",
        features: [withId("a")],
      });

      const body = parse(
        await getTrafficHandler({
          where: { mode: "within", queries: ["Amsterdam", "somewhere large"] },
        } as never)
      );

      // The cap is per area: two small areas far apart are a legitimate query,
      // and unioning them would invent an oversized bbox covering the gap.
      expect(mockGetTrafficIncidents).toHaveBeenCalledTimes(1);
      expect(body.searched.oversizedAreas).toBe(1);
      expect(body.searched.oversizedNote).toContain("10,000");
      expect(body.searched.oversizedNote).toContain("lower bound");
    });
  });
});
