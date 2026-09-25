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

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BBox } from "@tomtom-org/maps-sdk/core";
import { buildDynamicMap } from "./dynamicMapService";
import { tomtomClient } from "../base/tomtomClient";
import { getRoute, getMultiWaypointRoute } from "./routePlanService";
import type { RouteResult } from "../routing/types";

vi.mock("../base/tomtomClient", () => ({
  validateApiKey: vi.fn(),
  tomtomClient: { get: vi.fn() },
}));

vi.mock("./routePlanService", () => ({
  getRoute: vi.fn(),
  getMultiWaypointRoute: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockGetRoute = vi.mocked(getRoute);
const mockGetMultiWaypointRoute = vi.mocked(getMultiWaypointRoute);

function routeResponse(
  points: Array<[number, number]>,
  summary: { lengthInMeters: number; travelTimeInSeconds: number; trafficDelayInSeconds?: number }
): RouteResult {
  return {
    routes: [
      {
        summary: { trafficDelayInSeconds: 0, ...summary },
        legs: [{ points: points.map(([latitude, longitude]) => ({ latitude, longitude })) }],
      },
    ],
  } as unknown as RouteResult;
}

describe("buildDynamicMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds map state for markers without fetching anything", async () => {
    const result = await buildDynamicMap({
      markers: [{ lat: 52.374, lon: 4.8897, label: "Amsterdam", color: "#ff0000" }],
      width: 600,
      height: 400,
    });

    expect(result.width).toBe(600);
    expect(result.height).toBe(400);
    expect(result.mapState.sources.markers?.data.features).toHaveLength(1);
    expect(result.mapState.style).toEqual({
      endpoint: "maps/orbis/assets/styles/0.5.0-0/style.json",
      params: { apiVersion: "1", map: "basic_street-light" },
    });
    expect(result.summary).toEqual({
      markers: 1,
      polygons: 0,
      lines: 0,
      ignoredLines: 0,
      routePlans: [],
    });
    expect(result).not.toHaveProperty("base64");
    expect(vi.mocked(tomtomClient.get)).not.toHaveBeenCalled();
  });

  it("applies the default viewport", async () => {
    const result = await buildDynamicMap({ markers: [{ lat: 52.374, lon: 4.8897 }] });

    expect(result.width).toBe(600);
    expect(result.height).toBe(400);
  });

  it("keeps the requested viewport size within the schema bounds", async () => {
    const result = await buildDynamicMap({
      markers: [{ lat: 52.374, lon: 4.8897 }],
      width: 2000,
      height: 1500,
    });

    expect(result.width).toBe(2000);
    expect(result.height).toBe(1500);
    expect(result.mapState.options).toMatchObject({ width: 2000, height: 1500 });
  });

  it("throws when there is no content to display", async () => {
    await expect(buildDynamicMap({})).rejects.toThrow("Map requires content to display");
    await expect(
      buildDynamicMap({ center: { lat: 37.77, lon: -122.42 }, zoom: 12 })
    ).rejects.toThrow("Map requires content to display");
  });

  it("accepts a bbox together with markers", async () => {
    const result = await buildDynamicMap({
      bbox: [-122.5, 37.7, -122.3, 37.8] as BBox,
      markers: [{ lat: 37.75, lon: -122.4 }],
      width: 800,
      height: 600,
    });

    expect(result.mapState.view.center[0]).toBeCloseTo(-122.4);
    expect(result.mapState.view.center[1]).toBeCloseTo(37.75);
  });

  it("counts polygons and drawn lines", async () => {
    const result = await buildDynamicMap({
      polygons: [{ type: "circle", center: { lat: 52.37, lon: 4.89 }, radius: 1000 }],
      routes: [
        {
          points: [
            { lat: 52.37, lon: 4.89 },
            { lat: 52.36, lon: 4.88 },
          ],
        },
      ],
    } as Parameters<typeof buildDynamicMap>[0]);

    expect(result.summary.polygons).toBe(1);
    expect(result.summary.lines).toBe(1);
    expect(result.summary.ignoredLines).toBe(0);
    expect(result.mapState.sources.polygons).toBeDefined();
    expect(result.mapState.sources.routes).toBeDefined();
  });

  it("calculates a route plan through the Routing API and reports its outcome", async () => {
    mockGetRoute.mockResolvedValue(
      routeResponse(
        [
          [52.374, 4.8897],
          [52.368, 4.9],
          [52.365, 4.895],
        ],
        { lengthInMeters: 1234, travelTimeInSeconds: 300, trafficDelayInSeconds: 60 }
      )
    );

    const origin = { lat: 52.374, lon: 4.8897, label: "Dam Square" };
    const destination = { lat: 52.365, lon: 4.895, label: "Rijksmuseum" };
    const result = await buildDynamicMap({
      routePlans: [
        {
          origin,
          destination,
          label: "Museum walk",
          routeType: "shortest",
          travelMode: "pedestrian",
        },
      ],
    });

    expect(mockGetRoute).toHaveBeenCalledWith(
      origin,
      destination,
      expect.objectContaining({
        routeType: "shortest",
        travelMode: "pedestrian",
        traffic: false,
        instructionsType: "text",
        sectionType: [],
        computeTravelTimeFor: "all",
      })
    );
    expect(result.summary.routePlans).toEqual([
      {
        label: "Museum walk",
        originLabel: "Dam Square",
        destinationLabel: "Rijksmuseum",
        travelMode: "pedestrian",
        waypointCount: 0,
        lengthInMeters: 1234,
        travelTimeInSeconds: 300,
        trafficDelayInSeconds: 60,
      },
    ]);
    expect(result.summary.markers).toBe(2);
    expect(result.mapState.sources.routes?.data.features).toHaveLength(1);
  });

  it("uses the multi-waypoint route call when a plan has waypoints", async () => {
    mockGetMultiWaypointRoute.mockResolvedValue(
      routeResponse(
        [
          [52.374, 4.8897],
          [50.8503, 4.3517],
          [48.8566, 2.3522],
        ],
        { lengthInMeters: 502300, travelTimeInSeconds: 18720 }
      )
    );

    const result = await buildDynamicMap({
      routePlans: [
        {
          origin: { lat: 52.374, lon: 4.8897 },
          destination: { lat: 48.8566, lon: 2.3522 },
          waypoints: [{ lat: 50.8503, lon: 4.3517 }],
          label: "Amsterdam to Paris",
          travelMode: "truck",
        },
      ],
    });

    expect(mockGetMultiWaypointRoute).toHaveBeenCalled();
    expect(mockGetRoute).not.toHaveBeenCalled();
    expect(result.summary.routePlans[0]).toMatchObject({
      label: "Amsterdam to Paris",
      travelMode: "truck",
      waypointCount: 1,
      lengthInMeters: 502300,
    });
    expect(result.summary.routePlans[0]).not.toHaveProperty("originLabel");
    expect(result.summary.markers).toBe(3);
  });

  it("records a route plan error and still builds the rest of the map", async () => {
    mockGetRoute.mockRejectedValueOnce(new Error("Forbidden: invalid key")).mockResolvedValueOnce(
      routeResponse(
        [
          [48.86, 2.35],
          [48.85, 2.29],
        ],
        { lengthInMeters: 6000, travelTimeInSeconds: 900 }
      )
    );

    const result = await buildDynamicMap({
      routePlans: [
        { origin: { lat: 52.37, lon: 4.89 }, destination: { lat: 52.36, lon: 4.89 } },
        { origin: { lat: 48.86, lon: 2.35 }, destination: { lat: 48.85, lon: 2.29 } },
      ],
    });

    expect(result.summary.routePlans).toHaveLength(2);
    expect(result.summary.routePlans[0]).toMatchObject({
      label: "Route 1",
      error: "Forbidden: invalid key",
    });
    expect(result.summary.routePlans[0]).not.toHaveProperty("lengthInMeters");
    expect(result.summary.routePlans[1]).toMatchObject({
      label: "Route 2",
      lengthInMeters: 6000,
      travelTimeInSeconds: 900,
    });
    expect(result.summary.routePlans[1]).not.toHaveProperty("error");
    expect(result.mapState.sources.routes?.data.features).toHaveLength(1);
  });

  it("records an error when the Routing API returns no route", async () => {
    mockGetRoute.mockResolvedValue({ routes: [] } as unknown as RouteResult);

    const result = await buildDynamicMap({
      routePlans: [{ origin: { lat: 52.37, lon: 4.89 }, destination: { lat: 52.36, lon: 4.89 } }],
    });

    expect(result.summary.routePlans[0].error).toBe("The Routing API returned no route");
    expect(result.mapState.sources.routes).toBeUndefined();
  });

  it("counts drawn lines that are not shown because route plans were given", async () => {
    mockGetRoute.mockResolvedValue(
      routeResponse(
        [
          [52.37, 4.89],
          [52.36, 4.89],
        ],
        { lengthInMeters: 1000, travelTimeInSeconds: 120 }
      )
    );

    const result = await buildDynamicMap({
      routes: [
        {
          points: [
            { lat: 52.3, lon: 4.8 },
            { lat: 52.2, lon: 4.7 },
          ],
        },
      ],
      routePlans: [{ origin: { lat: 52.37, lon: 4.89 }, destination: { lat: 52.36, lon: 4.89 } }],
    } as Parameters<typeof buildDynamicMap>[0]);

    expect(result.summary.lines).toBe(0);
    expect(result.summary.ignoredLines).toBe(1);
  });
});
