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

const mockGetRoute = vi.fn();
const mockCalculateEVRoute = vi.fn();
const mockGetReachableRange = vi.fn();
const mockGetTrafficIncidents = vi.fn();
const mockGeocode = vi.fn();
const mockPoiSearch = vi.fn();

vi.mock("../../services/routing/routingService", () => ({
  getRoute: mockGetRoute,
  calculateEVRoute: mockCalculateEVRoute,
  getReachableRange: mockGetReachableRange,
}));
vi.mock("../../services/traffic/trafficService", () => ({
  getTrafficIncidents: mockGetTrafficIncidents,
}));
vi.mock("../../services/search/searchService", () => ({
  geocodeAddress: mockGeocode,
  poiSearch: mockPoiSearch,
}));
vi.mock("../../services/api-key", () => ({ getEffectiveApiKey: () => "key-test" }));
vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { planRouteHandler, findReachableAreasHandler, getTrafficHandler } = await import(
  "./plan-route"
);
const { clearDatasetStore, getDataset, storeDataset } = await import(
  "../../services/datasets/dataset-store"
);

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
      properties: { summary: { lengthInMeters: 654_000, travelTimeInSeconds: 23_400 } },
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  clearDatasetStore();
});

describe("planRouteHandler", () => {
  it("resolves place NAMES without a separate geocode call from the model", async () => {
    mockPoiSearch
      .mockResolvedValueOnce({ features: [point(4.9, 52.378, "Amsterdam Centraal")] })
      .mockResolvedValueOnce({ features: [point(4.885, 52.36, "Rijksmuseum")] });
    mockGetRoute.mockResolvedValue(route());

    const body = parse(
      await planRouteHandler({
        locations: [
          { query: "Amsterdam Centraal", queryAs: "poi" },
          { query: "Rijksmuseum", queryAs: "poi" },
        ],
      })
    );

    // The hop the locationInput union removes: one tool call, not three.
    expect(mockGetRoute).toHaveBeenCalledWith(
      [
        [4.9, 52.378],
        [4.885, 52.36],
      ],
      expect.anything()
    );
    // Echoing where each waypoint landed is how a mis-resolved name is
    // distinguishable from a bad route.
    expect(body.waypoints.map((w: { name: string }) => w.name)).toEqual([
      "Amsterdam Centraal",
      "Rijksmuseum",
    ]);
    expect(body._meta.dataset_id).toMatch(/^ds_/);
  });

  it("accepts explicit coordinates unchanged", async () => {
    mockGetRoute.mockResolvedValue(route());
    await planRouteHandler({ locations: [{ position: [1, 2] }, { position: [3, 4] }] });
    expect(mockGetRoute).toHaveBeenCalledWith(
      [
        [1, 2],
        [3, 4],
      ],
      expect.anything()
    );
    expect(mockGeocode).not.toHaveBeenCalled();
  });

  it("routes to EV planning when `ev` is present, and plain routing when it is not", async () => {
    mockGetRoute.mockResolvedValue(route());
    mockCalculateEVRoute.mockResolvedValue(route());

    await planRouteHandler({ locations: [{ position: [1, 2] }, { position: [3, 4] }] });
    expect(mockGetRoute).toHaveBeenCalledOnce();
    expect(mockCalculateEVRoute).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockCalculateEVRoute.mockResolvedValue(route());
    const body = parse(
      await planRouteHandler({
        locations: [{ position: [1, 2] }, { position: [3, 4] }],
        ev: { currentChargePercent: 80, maxChargeKWH: 60 },
      })
    );

    // EV is a branch of one task, not a second tool — this is what removed the
    // selection trap between two route-shaped tools.
    expect(mockCalculateEVRoute).toHaveBeenCalledOnce();
    expect(mockGetRoute).not.toHaveBeenCalled();
    expect(body.evPlanning).toBe(true);
  });

  it("passes intermediate stops as waypoints in EV mode", async () => {
    mockCalculateEVRoute.mockResolvedValue(route());
    await planRouteHandler({
      locations: [{ position: [1, 1] }, { position: [2, 2] }, { position: [3, 3] }],
      ev: { currentChargePercent: 50, maxChargeKWH: 60 },
    });
    expect(mockCalculateEVRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: [1, 1],
        destination: [3, 3],
        waypoints: [[2, 2]],
      })
    );
  });

  it("names which location failed to resolve", async () => {
    mockPoiSearch
      .mockResolvedValueOnce({ features: [point(1, 1, "ok")] })
      .mockResolvedValueOnce({ features: [] });

    const result = await planRouteHandler({
      locations: [
        { query: "a", queryAs: "poi" },
        { query: "nowhere-at-all", queryAs: "poi" },
      ],
    });

    expect(result.isError).toBe(true);
    expect(parse(result).error).toContain("location 2 of 2");
    expect(mockGetRoute).not.toHaveBeenCalled();
  });
});

describe("findReachableAreasHandler", () => {
  const polygon = () => ({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [4, 52],
              [5, 52],
              [5, 53],
              [4, 52],
            ],
          ],
        },
        properties: {},
      },
    ],
  });

  it("computes one area per origin per budget in a SINGLE call", async () => {
    mockGetReachableRange.mockResolvedValue(polygon());

    const body = parse(
      await findReachableAreasHandler({
        origins: [{ position: [4.9, 52.37] }],
        budgets: [
          { type: "time", value: 600 },
          { type: "time", value: 1200 },
          { type: "time", value: 1800 },
        ],
      })
    );

    // The old tool took one budget, so nested rings meant three tool calls and
    // three results the model had to correlate itself.
    expect(mockGetReachableRange).toHaveBeenCalledTimes(3);
    expect(body.areaCount).toBe(3);
    expect(body.origins[0].position).toEqual([4.9, 52.37]);
  });

  it("maps each budget type onto its service field", async () => {
    mockGetReachableRange.mockResolvedValue(polygon());
    await findReachableAreasHandler({
      origins: [{ position: [0, 0] }],
      budgets: [
        { type: "distance", value: 50_000 },
        { type: "energy", value: 12 },
      ],
    });
    expect(mockGetReachableRange).toHaveBeenCalledWith(
      [0, 0],
      expect.objectContaining({ distanceBudgetInMeters: 50_000 })
    );
    expect(mockGetReachableRange).toHaveBeenCalledWith(
      [0, 0],
      expect.objectContaining({ energyBudgetInkWh: 12 })
    );
  });

  it("stores the polygons so they can scope a follow-up search", async () => {
    mockGetReachableRange.mockResolvedValue(polygon());
    const body = parse(
      await findReachableAreasHandler({
        origins: [{ position: [0, 0] }],
        budgets: [{ type: "time", value: 600 }],
      })
    );

    const dataset = getDataset(body._meta.dataset_id);
    expect(dataset?.kind).toBe("ranges");
  });
});

describe("getTrafficHandler", () => {
  const incidents = (n: number) => ({
    incidents: Array.from({ length: n }, (_, i) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [4.9, 52.37] },
      properties: { magnitudeOfDelay: i % 4, roadNumbers: ["A10"], delay: 60 },
    })),
  });

  // An oversized bbox used to come back as a bare "Bad request to TomTom API",
  // which tells an agent nothing and costs it a retry to discover. The span of a
  // long route is the usual way to get there — and the one case with a better
  // answer than a smaller area, since the route already knows its own delays.
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
    expect(response.content[0].text).toContain("10,000 km²");
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

    const body = parse(
      await getTrafficHandler({ where: { mode: "within", queries: ["Amsterdam"] } })
    );

    expect(mockGetTrafficIncidents).toHaveBeenCalledWith([4.7, 52.3, 5.0, 52.4], expect.anything());
    expect(body.searched.scope).toContain("Amsterdam");
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
    expect(body.truncationNote).toContain("10 most severe of 500");
    expect(body.truncationNote).toContain("narrow the area");
    // …but it must also say what the visible rows CAN answer. The cap keeps the
    // most severe rather than an arbitrary slice, and a note that said only
    // "it is a sample" had the agent refuse to name the worst incident at all.
    expect(body.truncationNote).toMatch(/ranking questions/i);
    expect(body.truncationNote).toContain("Totals, counts and per-road breakdowns are NOT");
    // …and the full set really is addressable.
    expect(getDataset(body._meta.dataset_id)?.summary.count).toBe(500);
  });

  it("builds a bbox around a point for nearby mode", async () => {
    mockGetTrafficIncidents.mockResolvedValue(incidents(1));
    await getTrafficHandler({
      where: { mode: "nearby", position: [4.9, 52.37], radiusMeters: 2000 },
    });
    const [bbox] = mockGetTrafficIncidents.mock.calls[0];
    expect(bbox[0]).toBeLessThan(4.9);
    expect(bbox[2]).toBeGreaterThan(4.9);
  });

  it("refuses global traffic as a meaningless query", async () => {
    const result = await getTrafficHandler({ where: { mode: "global" } });
    expect(result.isError).toBe(true);
    expect(parse(result).error).toContain("needs an area");
    expect(mockGetTrafficIncidents).not.toHaveBeenCalled();
  });

  // The bug this replaced: `where` resolving to several areas queried the first
  // and appended "(only the first of N areas was queried)" to the scope. The
  // note was in the response and went unread — the agent reported one polygon's
  // incidents as the whole area's, the same quiet partial answer discover-places
  // was fixed for.
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
      properties: { magnitudeOfDelay: 3, roadNumbers: ["A10"], delay: 60 },
    });

    const both = { mode: "within", queries: ["Amsterdam", "Rotterdam"] };

    it("queries every resolved area, not just the first", async () => {
      twoCities();
      mockGetTrafficIncidents
        .mockResolvedValueOnce({ incidents: [withId("a"), withId("b")] })
        .mockResolvedValueOnce({ incidents: [withId("c")] });

      const body = parse(await getTrafficHandler({ where: both } as never));

      expect(mockGetTrafficIncidents).toHaveBeenCalledTimes(2);
      expect(mockGetTrafficIncidents.mock.calls.map(([bbox]) => bbox)).toEqual([
        [4.7, 52.3, 5.0, 52.4],
        [4.4, 51.9, 4.6, 52.0],
      ]);
      expect(body.searched.areasQueried).toBe(2);
      expect(body.incidents).toHaveLength(3);
      // The old scope suffix was the tell that a partial answer was on its way.
      expect(body.searched.scope).not.toContain("only the first");
    });

    it("counts an incident found in two overlapping areas once", async () => {
      twoCities();
      mockGetTrafficIncidents
        .mockResolvedValueOnce({ incidents: [withId("shared"), withId("a")] })
        .mockResolvedValueOnce({ incidents: [withId("shared")] });

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
        .mockResolvedValueOnce({ incidents: [withId("a")] })
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
      mockGetTrafficIncidents.mockResolvedValue({ incidents: [withId("a")] });

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
