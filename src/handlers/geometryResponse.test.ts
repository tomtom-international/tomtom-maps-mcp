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

// Pins the response_detail "geometry" contract per tool and backend
// (docs/adr/0004 to 0007). Fixtures are thinned live responses, so the shapes
// are the real API and SDK shapes.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import type { Position } from "geojson";
import { getVizData } from "../services/cache/vizCache";
import { roundPosition, VERTEX_CAP } from "./shared/simplify";
import { stripPointIndexes } from "./shared/geometryResponse";

const mocks = vi.hoisted(() => ({
  genesisRouting: {
    getRoute: vi.fn(),
    getMultiWaypointRoute: vi.fn(),
    getReachableRange: vi.fn(),
  },
  orbisRouting: { getRoute: vi.fn(), getReachableRange: vi.fn(), calculateEVRoute: vi.fn() },
  genesisTraffic: { getTrafficIncidents: vi.fn() },
  orbisTraffic: { getTrafficIncidents: vi.fn() },
  orbisSearch: {
    geocodeAddress: vi.fn(),
    reverseGeocode: vi.fn(),
    fuzzySearch: vi.fn(),
    poiSearch: vi.fn(),
    searchNearby: vi.fn(),
    fetchPOICategories: vi.fn(),
    searchInArea: vi.fn(),
    searchEVStations: vi.fn(),
    searchAlongRoute: vi.fn(),
  },
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/routing/routingService", () => mocks.genesisRouting);
vi.mock("../services/routing/routingOrbisService", () => mocks.orbisRouting);
vi.mock("../services/traffic/trafficService", () => mocks.genesisTraffic);
vi.mock("../services/traffic/trafficOrbisService", () => mocks.orbisTraffic);
vi.mock("../services/search/searchOrbisService", () => mocks.orbisSearch);
vi.mock("../utils/logger", () => ({ logger: mocks.logger }));

const genesisRouting = await import("./routingHandler");
const orbisRouting = await import("./routingOrbisHandler");
const genesisTraffic = await import("./trafficHandler");
const orbisTraffic = await import("./trafficOrbisHandler");
const orbisSearch = await import("./searchOrbisHandler");

type Json = Record<string, any>;
type Detail = "compact" | "geometry" | "full";

const loadFixture = (name: string): Json =>
  JSON.parse(
    readFileSync(new URL(`./shared/__fixtures__/geometry/${name}.json`, import.meta.url), "utf8")
  );

const AMS: Position = [4.9041, 52.3676];
const UTR: Position = [5.1214, 52.0907];
const BER: Position = [13.405, 52.52];
const latLon = ([lon, lat]: Position) => ({ lat, lon });

interface Case {
  name: string;
  fixture: string;
  mock: ReturnType<typeof vi.fn>;
  call: (detail: Detail, showUi?: boolean) => Promise<{ content: Array<{ text: string }> }>;
  /** Pinned feature types and properties, in order. */
  expected: Array<{ type: string; properties: Json }>;
  /** Where each line or ring came from in the raw response, to compare endpoints. */
  source?: (raw: Json) => Position[][];
  orbis?: boolean;
}

const genesisPoints = (points: Array<{ latitude: number; longitude: number }>): Position[] =>
  points.map((p) => [p.longitude, p.latitude]);

const cases: Case[] = [
  {
    name: "tomtom-maps routing",
    fixture: "genesis-route",
    mock: mocks.genesisRouting.getRoute,
    call: (detail) =>
      genesisRouting.createRoutingHandler()({
        origin: latLon(AMS),
        destination: latLon(BER),
        response_detail: detail,
      }),
    expected: [{ type: "LineString", properties: { route: 0 } }],
    source: (raw) => [genesisPoints(raw.routes[0].legs[0].points)],
  },
  {
    name: "tomtom-maps waypoint routing",
    fixture: "genesis-waypoint-route",
    mock: mocks.genesisRouting.getMultiWaypointRoute,
    call: (detail) =>
      genesisRouting.createWaypointRoutingHandler()({
        waypoints: [latLon(AMS), latLon(UTR), latLon(BER)],
        response_detail: detail,
      }),
    expected: [{ type: "LineString", properties: { route: 0 } }],
    source: (raw) => [
      genesisPoints(raw.routes[0].legs.flatMap((leg: Json) => leg.points)).filter(
        (p, i, all) => i === 0 || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1]
      ),
    ],
  },
  {
    name: "tomtom-maps reachable range",
    fixture: "genesis-reachable-range",
    mock: mocks.genesisRouting.getReachableRange,
    call: (detail) =>
      genesisRouting.createReachableRangeHandler()({
        origin: latLon(AMS),
        timeBudgetInSec: 1800,
        response_detail: detail,
      }),
    expected: [{ type: "Polygon", properties: { range: 0, budget_min: 30 } }],
    // The API leaves the boundary open; GeoJSON rings are closed.
    source: (raw) => {
      const ring = genesisPoints(raw.reachableRange.boundary);
      return [[...ring, ring[0]]];
    },
  },
  {
    name: "tomtom-maps traffic",
    fixture: "genesis-traffic",
    mock: mocks.genesisTraffic.getTrafficIncidents,
    call: (detail) =>
      genesisTraffic.createTrafficHandler()({
        bbox: "4.85,52.33,4.95,52.40",
        response_detail: detail,
      }),
    expected: [0, 1, 2].map((incident) => ({ type: "LineString", properties: { incident } })),
    source: (raw) => raw.incidents.map((i: Json) => i.geometry.coordinates),
  },
  {
    name: "orbis routing",
    fixture: "orbis-route",
    mock: mocks.orbisRouting.getRoute,
    orbis: true,
    call: (detail, showUi = false) =>
      orbisRouting.createRoutingHandler()({
        locations: [AMS, BER],
        response_detail: detail,
        show_ui: showUi,
      }),
    expected: [{ type: "LineString", properties: { route: 0 } }],
    source: (raw) => [raw.features[0].geometry.coordinates],
  },
  {
    name: "orbis EV routing",
    fixture: "orbis-ev-route",
    mock: mocks.orbisRouting.calculateEVRoute,
    orbis: true,
    call: (detail, showUi = false) =>
      orbisRouting.createEVRoutingHandler()({
        origin: AMS,
        destination: BER,
        currentChargePercent: 80,
        maxChargeKWH: 75,
        response_detail: detail,
        show_ui: showUi,
      }),
    expected: [
      { type: "LineString", properties: { route: 0 } },
      // Legs 0 to 2 end at a charging stop; the last leg ends at the destination.
      { type: "Point", properties: { route: 0, leg: 0 } },
      { type: "Point", properties: { route: 0, leg: 1 } },
      { type: "Point", properties: { route: 0, leg: 2 } },
    ],
    source: (raw) => [raw.features[0].geometry.coordinates],
  },
  {
    name: "orbis reachable range",
    fixture: "orbis-reachable-range",
    mock: mocks.orbisRouting.getReachableRange,
    orbis: true,
    call: (detail, showUi = false) =>
      orbisRouting.createReachableRangeHandler()({
        origin: AMS,
        timeBudgetInSec: 1800,
        response_detail: detail,
        show_ui: showUi,
      }),
    expected: [60, 45, 30, 15].map((budget_min, range) => ({
      type: "Polygon",
      properties: { range, budget_min },
    })),
    // The SDK also leaves rings open (800 points, last != first); they are closed.
    source: (raw) =>
      raw.features.map((f: Json) => [...f.geometry.coordinates[0], f.geometry.coordinates[0][0]]),
  },
  {
    name: "orbis traffic",
    fixture: "orbis-traffic",
    mock: mocks.orbisTraffic.getTrafficIncidents,
    orbis: true,
    call: (detail, showUi = false) =>
      orbisTraffic.createTrafficHandler()({
        bbox: [4.85, 52.33, 4.95, 52.4],
        response_detail: detail,
        show_ui: showUi,
      }),
    expected: [0, 1, 2].map((incident) => ({ type: "LineString", properties: { incident } })),
    source: (raw) => raw.incidents.map((i: Json) => i.geometry.coordinates),
  },
  {
    name: "orbis area search",
    fixture: "orbis-area-search",
    mock: mocks.orbisSearch.searchInArea,
    orbis: true,
    call: (detail, showUi = false) =>
      orbisSearch.createAreaSearchHandler()({
        query: "restaurant",
        center: AMS,
        radius: 1000,
        response_detail: detail,
        show_ui: showUi,
      }),
    expected: [{ type: "Polygon", properties: { boundary: "circle" } }],
  },
  {
    name: "orbis search along route",
    fixture: "orbis-search-along-route",
    mock: mocks.orbisSearch.searchAlongRoute,
    orbis: true,
    call: (detail, showUi = false) =>
      orbisSearch.createSearchAlongRouteHandler()({
        origin: AMS,
        destination: UTR,
        query: "petrol station",
        response_detail: detail,
        show_ui: showUi,
      } as Parameters<ReturnType<typeof orbisSearch.createSearchAlongRouteHandler>>[0]),
    expected: [{ type: "LineString", properties: { route: 0 } }],
    source: (raw) => [raw.route.features[0].geometry.coordinates],
  },
];

async function run(c: Case, detail: Detail, raw: Json = loadFixture(c.fixture), showUi = false) {
  c.mock.mockResolvedValue(raw);
  const response = await c.call(detail, showUi);
  return { text: response.content[0].text, body: JSON.parse(response.content[0].text) as Json };
}

const withoutMeta = ({ _meta, geometry, ...rest }: Json) => rest;

/** Every [x, y] position in a GeoJSON geometry. */
const positions = (coordinates: unknown): Position[] =>
  Array.isArray(coordinates) && typeof coordinates[0] === "number"
    ? [coordinates as Position]
    : (coordinates as unknown[]).flatMap(positions);

const decimals = (value: number) => (String(value).split(".")[1] ?? "").length;

describe.each(cases)("response_detail geometry: $name", (c) => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a FeatureCollection with one feature per item and a join key", async () => {
    const { body } = await run(c, "geometry");

    expect(body.geometry.type).toBe("FeatureCollection");
    expect(Object.keys(body.geometry)).toEqual(["type", "features"]);
    expect(
      body.geometry.features.map((f: Json) => ({ type: f.geometry.type, properties: f.properties }))
    ).toEqual(c.expected);
    for (const feature of body.geometry.features) {
      expect(Object.keys(feature).sort()).toEqual(["geometry", "properties", "type"]);
      expect(feature.type).toBe("Feature");
      expect(Object.keys(feature.geometry).sort()).toEqual(["coordinates", "type"]);
    }
  });

  it("uses [lon, lat] order, rounded to 5 decimals", async () => {
    const { body } = await run(c, "geometry");
    const all = body.geometry.features.flatMap((f: Json) => positions(f.geometry.coordinates));

    expect(all.length).toBeGreaterThan(0);
    for (const [lon, lat] of all) {
      // Every fixture lies in the Netherlands or Germany.
      expect(lon).toBeGreaterThan(3);
      expect(lon).toBeLessThan(15);
      expect(lat).toBeGreaterThan(50);
      expect(lat).toBeLessThan(54);
      expect(decimals(lon)).toBeLessThanOrEqual(5);
      expect(decimals(lat)).toBeLessThanOrEqual(5);
    }
  });
});

describe.each(cases.filter((c) => c.source))("response_detail geometry: $name", (c) => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the API's lines and rings, rounded, below the cap", async () => {
    const raw = loadFixture(c.fixture);
    const { body } = await run(c, "geometry", raw);
    const paths = c.source?.(raw) ?? [];
    const lines = body.geometry.features.filter((f: Json) => f.geometry.type !== "Point");

    expect(lines).toHaveLength(paths.length);
    lines.forEach((feature: Json, i: number) => {
      const coordinates =
        feature.geometry.type === "Polygon"
          ? feature.geometry.coordinates[0]
          : feature.geometry.coordinates;
      expect(coordinates).toEqual(paths[i].map(roundPosition));
      expect(feature.properties.simplification).toBeUndefined();
    });
  });
});

describe.each(cases)("response_detail geometry: $name", (c) => {
  beforeEach(() => vi.clearAllMocks());

  it("carries the compact response unchanged apart from vertex indexes", async () => {
    const compact = (await run(c, "compact")).body;
    const { body, text } = await run(c, "geometry");

    expect(withoutMeta(body)).toEqual(stripPointIndexes(withoutMeta(compact)));
    expect(text).not.toMatch(/"(startPointIndex|endPointIndex|pointIndex)"/);
  });
});

describe.each(cases.filter((c) => c.orbis))("response_detail geometry: $name", (c) => {
  beforeEach(() => vi.clearAllMocks());

  it("caches the untrimmed result for the widget, as compact does", async () => {
    const raw = loadFixture(c.fixture);
    const { body } = await run(c, "geometry", raw, true);

    expect(body._meta).toEqual({ show_ui: true, viz_id: expect.any(String) });
    expect(await getVizData(body._meta.viz_id)).toMatchObject(raw);
  });

  it("returns show_ui false in _meta without caching", async () => {
    const { body } = await run(c, "geometry");
    expect(body._meta).toEqual({ show_ui: false });
  });
});

describe("response_detail geometry above the vertex cap", () => {
  beforeEach(() => vi.clearAllMocks());

  /** A 5,000-point curve from Amsterdam towards Berlin. */
  const longLine = (): Position[] =>
    Array.from({ length: 5000 }, (_, i) => {
      const t = i / 4999;
      return [4.9 + t * 8.5 + Math.sin(t * 40) * 0.05, 52.37 + t * 0.15 + Math.cos(t * 55) * 0.04];
    });

  const expectSimplified = (feature: Json, originalPoints: number, line: Position[]) => {
    const coordinates = feature.geometry.coordinates as Position[];
    expect(coordinates.length).toBeLessThanOrEqual(VERTEX_CAP);
    expect(coordinates[0]).toEqual(roundPosition(line[0]));
    expect(coordinates[coordinates.length - 1]).toEqual(roundPosition(line[line.length - 1]));
    expect(feature.properties).toEqual({
      route: 0,
      simplification: {
        original_points: originalPoints,
        points: coordinates.length,
        max_error_m: expect.any(Number),
      },
    });
    expect(feature.properties.simplification.max_error_m).toBeGreaterThan(0);
  };

  it("simplifies a long TomTom Maps route and reports it", async () => {
    const line = longLine();
    const raw = loadFixture("genesis-route");
    raw.routes[0].legs[0].points = line.map(([longitude, latitude]) => ({ latitude, longitude }));
    const { body } = await run(cases[0], "geometry", raw);

    expectSimplified(body.geometry.features[0], 5000, line);
  });

  it("simplifies a long Orbis route and reports it", async () => {
    const line = longLine();
    const raw = loadFixture("orbis-route");
    raw.features[0].geometry.coordinates = line;
    const { body } = await run(cases[4], "geometry", raw);

    expectSimplified(body.geometry.features[0], 5000, line);
  });
});

describe("traffic join keys follow the capped compact order", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["tomtom-maps", cases[3], { bbox: "4.85,52.33,4.95,52.40", maxResults: 2 }],
    ["orbis", cases[7], { bbox: [4.85, 52.33, 4.95, 52.4], maxResults: 2, show_ui: false }],
  ] as const)("%s: incident i in geometry is incidents[i] in compact", async (_, c, params) => {
    const raw = loadFixture(c.fixture);
    raw.incidents.forEach((incident: Json, i: number) => {
      incident.properties.magnitudeOfDelay = [1, 4, 2][i];
    });
    c.mock.mockResolvedValue(raw);
    const handler =
      c === cases[3] ? genesisTraffic.createTrafficHandler() : orbisTraffic.createTrafficHandler();
    const response = await handler({ ...params, response_detail: "geometry" } as never);
    const body = JSON.parse(response.content[0].text);

    // The cap keeps the two most severe: raw incidents 1 and 2, in that order.
    const kept = [raw.incidents[1], raw.incidents[2]];
    expect(body.incidents.map((i: Json) => i.magnitudeOfDelay)).toEqual([4, 2]);
    expect(body.geometry.features.map((f: Json) => f.properties)).toEqual([
      { incident: 0 },
      { incident: 1 },
    ]);
    body.geometry.features.forEach((feature: Json, i: number) => {
      expect(body.incidents[i].from).toBe(kept[i].properties.from);
      expect(feature.geometry.coordinates).toEqual(kept[i].geometry.coordinates.map(roundPosition));
    });
  });

  it("returns Point incidents as Points", async () => {
    const raw = loadFixture("orbis-traffic");
    raw.incidents[1].geometry = { type: "Point", coordinates: [4.8987654, 52.3712345] };
    const { body } = await run(cases[7], "geometry", raw);

    expect(body.geometry.features[1]).toEqual({
      type: "Feature",
      geometry: { type: "Point", coordinates: [4.89877, 52.37123] },
      properties: { incident: 1 },
    });
  });
});

describe("area search boundary shapes", () => {
  beforeEach(() => vi.clearAllMocks());

  const areaSearch = (params: Json) => {
    mocks.orbisSearch.searchInArea.mockResolvedValue(loadFixture("orbis-area-search"));
    return orbisSearch
      .createAreaSearchHandler()({
        query: "restaurant",
        response_detail: "geometry",
        show_ui: false,
        ...params,
      } as never)
      .then((r) => JSON.parse(r.content[0].text).geometry.features);
  };

  it("returns a closed 64-segment circle", async () => {
    const [feature] = await areaSearch({ center: AMS, radius: 1000 });
    const ring = feature.geometry.coordinates[0];
    expect(ring).toHaveLength(65);
    expect(ring[0]).toEqual(ring[64]);
  });

  it("returns a caller polygon, closed", async () => {
    const polygon = [
      [4.88, 52.36],
      [4.92, 52.36],
      [4.92, 52.38],
    ];
    const [feature] = await areaSearch({ polygon });
    expect(feature).toEqual({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[...polygon, polygon[0]]] },
      properties: { boundary: "polygon" },
    });
  });

  it("returns a bounding box as a closed rectangle", async () => {
    const [feature] = await areaSearch({
      boundingBox: [
        [4.88, 52.38],
        [4.92, 52.36],
      ],
    });
    expect(feature.properties).toEqual({ boundary: "boundingBox" });
    expect(feature.geometry.coordinates[0]).toHaveLength(5);
  });
});

describe("geometry output never contains the API key", () => {
  const KEY = "geometry-test-api-key";

  /** Adds apiKey to every object in a raw response, as an SDK echo of request params would. */
  const injectKey = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(injectKey);
    if (!value || typeof value !== "object") return value;
    const out: Json = { apiKey: KEY };
    for (const [k, v] of Object.entries(value)) out[k] = injectKey(v);
    return out;
  };

  it.each(cases)("$name", async (c) => {
    const { body } = await run(c, "geometry", injectKey(loadFixture(c.fixture)) as Json);
    const geometry = JSON.stringify(body.geometry);

    expect(body.geometry.features.length).toBeGreaterThan(0);
    expect(geometry).not.toContain(KEY);
    expect(geometry).not.toContain("apiKey");
  });

  it("the Orbis reachable range response, whose SDK properties echo the key, is clean", async () => {
    const raw = loadFixture("orbis-reachable-range");
    expect(JSON.stringify(raw)).toContain('"apiKey":"test-api-key"');
    const { text } = await run(cases[6], "geometry", raw);

    expect(text).not.toContain("test-api-key");
    expect(text).not.toContain("apiKey");
  });
});
