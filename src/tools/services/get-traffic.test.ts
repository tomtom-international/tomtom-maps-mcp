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
}));
vi.mock("../../services/base/tomtomClient", () => ({ getEffectiveApiKey: () => "key-test" }));
vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { getTrafficHandler } = await import("./get-traffic");
const { requireDataset, storeDataset } = await import("../../services/datasets/dataset-store");
const { tomtomGetTrafficSchema } = await import("../../schemas/traffic/trafficSchema");
const { z } = await import("zod");

const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

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

  it("queries a named area by its outline", async () => {
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
    const outline = {
      type: "Polygon",
      coordinates: [
        [
          [4.85, 52.35],
          [4.92, 52.35],
          [4.92, 52.38],
          [4.85, 52.35],
        ],
      ],
    };
    mockFetchBoundaries.mockResolvedValueOnce({ features: [{ id: "b-1", geometry: outline }] });
    mockGetTrafficIncidents.mockResolvedValue(incidents(1));

    const body = parse(
      await getTrafficHandler({ where: { mode: "within", queries: ["Amsterdam-Centrum"] } })
    );

    expect(mockFetchBoundaries).toHaveBeenCalledWith(["b-1"]);
    expect(mockGetTrafficIncidents).toHaveBeenCalledWith(outline, expect.anything());
    expect(body.searched.scope).toBe("Amsterdam-Centrum");
    expect(body.searched.resolvedAreas[0].area).toMatchObject({ boundaryId: "b-1" });
  });

  it("queries a named area by its bounds when its outline is unavailable", async () => {
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
    mockFetchBoundaries.mockRejectedValueOnce(new Error("Rate limit exceeded"));
    mockGetTrafficIncidents.mockResolvedValue(incidents(1));

    const body = parse(
      await getTrafficHandler({ where: { mode: "within", queries: ["Amsterdam-Centrum"] } })
    );

    expect(mockGetTrafficIncidents).toHaveBeenCalledWith(
      [4.8, 52.33, 4.95, 52.4],
      expect.anything()
    );
    // Said, so the bounds read as a fallback and not as an area without an outline.
    expect(body.searched.scope).toBe(
      "Amsterdam-Centrum (bounding box: its outline could not be fetched, Rate limit exceeded)"
    );
  });

  it("gives a full result the searched bounds, which it otherwise lacks for the app to frame", async () => {
    mockGeocode.mockResolvedValue({
      features: [
        {
          type: "Feature",
          bbox: [4.7, 52.3, 5.0, 52.4],
          geometry: { type: "Point" },
          properties: {},
        },
      ],
    });
    mockGetTrafficIncidents.mockResolvedValue(incidents(0));
    const where = { mode: "within" as const, queries: ["Amsterdam"] };

    const full = parse(await getTrafficHandler({ where, response_detail: "full" }));
    const compact = parse(await getTrafficHandler({ where }));

    expect(full.bbox).toEqual([4.7, 52.3, 5.0, 52.4]);
    expect(compact).not.toHaveProperty("bbox");
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
    expect(body.incidentSummary.note).toContain("10 most severe of 500 incidents, ranked by delay");
    expect(body.incidentSummary.note).toContain("tomtom-analyse-datasets");
    // …but it must also say what the visible rows CAN answer. The cap keeps the
    // most severe rather than an arbitrary slice, and a note that said only
    // "it is a sample" had the agent refuse to name the worst incident at all.
    expect(body.incidentSummary.note).toMatch(/ranking questions/i);
    expect(body.incidentSummary.note).toContain("per-road counts above cover all 500");
  });

  it("answers response_detail dataset with every incident's count and summary, held with what it searched", async () => {
    mockGeocode.mockResolvedValue({
      features: [
        { type: "Feature", bbox: [4, 52, 5, 53], geometry: { type: "Point" }, properties: {} },
      ],
    });
    mockGetTrafficIncidents.mockResolvedValue(incidents(500));

    const body = parse(
      await getTrafficHandler({
        where: { mode: "within", queries: ["Amsterdam"] },
        maxResults: 10,
        response_detail: "dataset",
      })
    );

    expect(body).not.toHaveProperty("incidents");
    expect(body.rows).toBe(500);
    expect(body.incidentSummary).toMatchObject({ totalIncidents: 500, byRoad: [{ road: "A10" }] });
    expect(body.incidentSummary).not.toHaveProperty("returnedIncidents");
    expect(body.incidentSummary).not.toHaveProperty("note");
    const held = requireDataset(body.dataset_id);
    expect(held.features).toHaveLength(500);
    expect(held.data).toMatchObject({ searched: { mode: "within" } });
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

    it("covers only the stretch asked for, and lists it", async () => {
      mockGetRoute.mockResolvedValue(route());
      mockGetTrafficIncidents.mockResolvedValue(incidents(1));

      const body = parse(
        await getTrafficHandler({
          where: { ...amsterdamToBerlin, stretch: { lastMeters: 50_000 } },
        })
      );

      const areas = mockGetTrafficIncidents.mock.calls.map(([area]) => area);
      expect(areas).toHaveLength(1);
      // The last 50 km of 654 km start about 92% of the way, east of 12.7°.
      expect(turf.bbox(areas[0])[0]).toBeGreaterThan(12.7);
      expect(body.searched.stretch).toEqual({
        stretches: [{ fromMeters: 604_000, toMeters: 654_000 }],
        searchedMeters: 50_000,
        routeMeters: 654_000,
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

    it("keeps how far along each incident starts in the dataset too", async () => {
      mockGetRoute.mockResolvedValue(route());
      const [atAmsterdam, atBerlin] = incidents(2).features;
      atBerlin.geometry.coordinates = [13.4, 52.52];
      mockGetTrafficIncidents.mockResolvedValue({
        type: "FeatureCollection",
        features: [atBerlin, atAmsterdam],
      });

      const { dataset_id } = parse(await getTrafficHandler({ where: amsterdamToBerlin }));

      expect(
        requireDataset(dataset_id).features.map(({ properties }) => properties?.startsAfterMeters)
      ).toEqual([0, 654_000]);
    });

    it("lists the incidents along a derived line in driving order too, measured along it", async () => {
      const line = route().features[0];
      const { id } = storeDataset(
        {
          type: "FeatureCollection",
          features: [{ type: "Feature", geometry: line.geometry, properties: {} }],
        },
        { tool: "tomtom-derive-datasets", params: {} }
      );
      const [atAmsterdam, atBerlin] = incidents(2).features;
      atBerlin.geometry.coordinates = [13.4, 52.52];
      atBerlin.properties.roadNumbers = ["A100"];
      mockGetTrafficIncidents.mockResolvedValue({
        type: "FeatureCollection",
        features: [atBerlin, atAmsterdam],
      });

      const body = parse(
        await getTrafficHandler({ where: { mode: "alongRoute", dataset_id: id } })
      );

      expect(mockGetRoute).not.toHaveBeenCalled();
      const order = body.incidents.map(
        (incident: { startsAfterMeters: number; roadNumbers: string[] }) => incident.roadNumbers
      );
      expect(order).toEqual([["A10"], ["A100"]]);
      expect(body.incidents[0].startsAfterMeters).toBe(0);
      const lineMeters = turf.length(line as never, { units: "meters" });
      expect(body.incidents[1].startsAfterMeters).toBeCloseTo(lineMeters, -3);
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

    it("says a cut list keeps the most severe, listed in driving order rather than by severity", async () => {
      mockGetRoute.mockResolvedValue(route());
      mockGetTrafficIncidents.mockResolvedValue(incidents(5));

      const body = parse(await getTrafficHandler({ where: amsterdamToBerlin, maxResults: 2 }));

      expect(body.incidentSummary.note).toContain(
        "2 most severe of 5 incidents, listed in the order the drive meets them"
      );
      expect(body.incidentSummary.note).not.toContain("ranked by delay magnitude");
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
    expect(response.content[0].text).toMatch(/needs `position`.*`query`/);
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

  it("sends only its own inputs beside `where`: maxResults, but not a search's limit", () => {
    const messageOf = (where: object) =>
      z.object(tomtomGetTrafficSchema).safeParse({ where }).error?.issues[0].message;

    expect(messageOf({ mode: "nearby", query: "Dam Square", maxResults: 5 })).toContain(
      "maxResults goes beside `where`"
    );
    expect(messageOf({ mode: "nearby", query: "Dam Square", limit: 5 })).not.toContain("beside");
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

    // Too far apart to share one request under the cap.
    const twoCities = () => {
      mockGeocode
        .mockResolvedValueOnce(city("Amsterdam", [4.7, 52.3, 5.0, 52.4]))
        .mockResolvedValueOnce(city("Paris", [2.2, 48.8, 2.5, 48.9]));
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

    const both = { mode: "within", queries: ["Amsterdam", "Paris"] };

    it("queries areas that fit under the cap together in one request", async () => {
      mockGeocode
        .mockResolvedValueOnce(city("Amsterdam", [4.7, 52.3, 5.0, 52.4]))
        .mockResolvedValueOnce(city("Rotterdam", [4.4, 51.9, 4.6, 52.0]));
      mockGetTrafficIncidents.mockResolvedValueOnce({
        type: "FeatureCollection",
        features: [withId("a"), withId("c")],
      });

      const body = parse(
        await getTrafficHandler({
          where: { mode: "within", queries: ["Amsterdam", "Rotterdam"] },
        } as never)
      );

      expect(mockGetTrafficIncidents).toHaveBeenCalledTimes(1);
      const [[area]] = mockGetTrafficIncidents.mock.calls;
      expect(area).toMatchObject({ type: "MultiPolygon" });
      expect(area.coordinates).toHaveLength(2);
      expect(body.searched.areasQueried).toBe(2);
      expect(body.incidents).toHaveLength(2);
    });

    it("queries every resolved area, not just the first", async () => {
      twoCities();
      mockGetTrafficIncidents
        .mockResolvedValueOnce({ type: "FeatureCollection", features: [withId("a"), withId("b")] })
        .mockResolvedValueOnce({ type: "FeatureCollection", features: [withId("c")] });

      const body = parse(await getTrafficHandler({ where: both } as never));

      expect(mockGetTrafficIncidents).toHaveBeenCalledTimes(2);
      expect(mockGetTrafficIncidents.mock.calls.map(([bbox]) => bbox)).toEqual([
        [4.7, 52.3, 5.0, 52.4],
        [2.2, 48.8, 2.5, 48.9],
      ]);
      expect(body.searched.areasQueried).toBe(2);
      expect(body.incidents).toHaveLength(3);
      expect(body.searched.resolvedAreas).toMatchObject([
        { query: "Amsterdam", matched: "Amsterdam", area: { boundingBox: [4.7, 52.3, 5, 52.4] } },
        { query: "Paris", matched: "Paris", area: { name: "Paris" } },
      ]);
    });

    it("counts an incident two requests both return once", async () => {
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

    it("returns the areas that worked, and says why the rest did not", async () => {
      twoCities();
      mockGetTrafficIncidents
        .mockResolvedValueOnce({ type: "FeatureCollection", features: [withId("a")] })
        .mockRejectedValueOnce(new Error("upstream exploded"));

      const body = parse(await getTrafficHandler({ where: both } as never));

      expect(body.incidents).toHaveLength(1);
      // A lower bound presented as a total is the fabrication being designed out.
      expect(body.searched.note).toContain("could not be queried: upstream exploded");
      expect(body.searched.failedRequests).toBe(1);
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
