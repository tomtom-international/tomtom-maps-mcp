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
import { APP_DATA } from "../shared/app-data";

const mockGetRoute = vi.fn();
const mockFuzzySearch = vi.fn();
const mockReverseGeocode = vi.fn();

vi.mock("../../services/routing/routingService", () => ({
  getRoute: mockGetRoute,
}));
vi.mock("../../services/search/searchService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/search/searchService")>()),
  fuzzySearch: mockFuzzySearch,
  reverseGeocode: mockReverseGeocode,
}));
vi.mock("../../services/base/tomtomClient", () => ({ getEffectiveApiKey: () => "key-test" }));
vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { planRouteHandler } = await import("./plan-route");

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
    expect(checkpoint.nearUnavailable).toBe("429 Too Many Requests");
  });

  it.each([
    ["live", undefined, true],
    ["historical", "historical", false],
  ] as const)(
    "with %s traffic, says what to try when the API finds no route",
    async (_, traffic, hinted) => {
      const noRoute =
        "Engine error while executing route request: NO_ROUTE_FOUND: No valid route found";
      mockGetRoute.mockRejectedValueOnce(Object.assign(new Error(noRoute), { status: 400 }));
      const response = await planRouteHandler({
        locations: [{ position: [10.37, 46.47] }, { position: [11.16, 46.67] }],
        traffic,
      });

      expect(response.isError).toBe(true);
      expect(parse(response).details.hint !== undefined).toBe(hinted);
    }
  );

  it("keeps the route when the usual-traffic comparison fails, saying why", async () => {
    mockGetRoute
      .mockResolvedValueOnce(route())
      .mockRejectedValueOnce(Object.assign(new Error("Too Many Requests"), { status: 429 }));
    const response = await planRouteHandler({
      locations: [{ position: [4.9, 52.37] }, { position: [13.4, 52.52] }],
      compareWithUsualRoute: true,
    });

    expect(response.isError).toBeFalsy();
    const body = parse(response);
    expect(body.waypoints).toHaveLength(2);
    expect(body.usualRoute.unavailable).toMatch(/^Rate limit exceeded.*ask again to compare/);
  });

  // A 400 there is the caller's input, which a second try would only repeat.
  it("fails the call when the API rejects the usual-traffic comparison's request", async () => {
    mockGetRoute
      .mockResolvedValueOnce(route())
      .mockRejectedValueOnce(Object.assign(new Error("Invalid request"), { status: 400 }));
    const response = await planRouteHandler({
      locations: [{ position: [4.9, 52.37] }, { position: [13.4, 52.52] }],
      compareWithUsualRoute: true,
    });

    expect(response.isError).toBe(true);
    expect(parse(response)).not.toHaveProperty("usualRoute");
  });

  it("slots one stop between an origin and a destination without planning a route first", async () => {
    mockGetRoute.mockResolvedValue(route());
    const body = parse(
      await planRouteHandler({
        locations: [{ position: [4.9, 52.37] }, { position: [13.4, 52.52] }],
        insertStops: [{ position: [7, 52.42] }],
      })
    );

    expect(mockGetRoute).toHaveBeenCalledTimes(1);
    expect(body.waypoints.map((w: { position: number[] }) => w.position)).toEqual([
      [4.9, 52.37],
      [7, 52.42],
      [13.4, 52.52],
    ]);
  });
});
