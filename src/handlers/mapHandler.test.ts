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
import type { DynamicMapResponse } from "../services/map/dynamicMapTypes";

vi.mock("../services/map/dynamicMapService", () => ({
  buildDynamicMap: vi.fn(),
}));

vi.mock("../services/cache/vizCache", () => ({
  storeVizData: vi.fn(),
}));

vi.mock("../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { buildDynamicMap } from "../services/map/dynamicMapService";
import { storeVizData } from "../services/cache/vizCache";
import { logger } from "../utils/logger";
import { createDynamicMapHandler, describeDynamicMap } from "./mapHandler";

const mockBuildDynamicMap = vi.mocked(buildDynamicMap);
const mockStoreVizData = vi.mocked(storeVizData);

function fakeResult(overrides: Partial<DynamicMapResponse["summary"]> = {}): DynamicMapResponse {
  return {
    width: 800,
    height: 600,
    mapState: {
      style: { endpoint: "style.json", params: {} },
      view: {
        center: [4.89, 52.37],
        zoom: 10,
        bounds: { north: 52.4, south: 52.3, east: 4.95, west: 4.8 },
      },
      sources: {},
      layers: [],
      options: { width: 800, height: 600, showLabels: false },
    },
    summary: {
      markers: 2,
      polygons: 0,
      lines: 0,
      ignoredLines: 0,
      routePlans: [],
      ...overrides,
    },
  };
}

type TextBlock = { type: string; text: string };

beforeEach(() => {
  vi.clearAllMocks();
  mockStoreVizData.mockResolvedValue("viz-123");
});

describe("createDynamicMapHandler", () => {
  it("returns a text summary and the _meta block, and no image", async () => {
    mockBuildDynamicMap.mockResolvedValue(fakeResult());

    const response = await createDynamicMapHandler()({
      markers: [
        { lat: 52.37, lon: 4.89 },
        { lat: 52.36, lon: 4.88 },
      ],
    });

    expect(response.isError).toBeUndefined();
    expect(response.content).toHaveLength(2);
    expect(response.content.every((c) => c.type === "text")).toBe(true);
    expect(response.content.some((c) => (c.type as string) === "image")).toBe(false);

    const summary = (response.content[0] as TextBlock).text;
    expect(summary).toContain("800x600 px");
    expect(summary).toContain("2 markers, 0 polygons, 0 drawn lines, 0 calculated routes");
    expect(summary).toContain("rendered by the tomtom-dynamic-map MCP app");
    expect(summary).not.toContain("Routes:");
  });

  it("caches the map state and returns its viz_id when show_ui is true", async () => {
    const result = fakeResult();
    mockBuildDynamicMap.mockResolvedValue(result);

    const response = await createDynamicMapHandler()({
      markers: [{ lat: 52.37, lon: 4.89 }],
      show_ui: true,
    });

    expect(mockStoreVizData).toHaveBeenCalledWith(result.mapState);
    const meta = JSON.parse((response.content[1] as TextBlock).text);
    expect(meta).toEqual({ _meta: { show_ui: true, viz_id: "viz-123" } });
  });

  it("defaults show_ui to true when the caller omits it", async () => {
    mockBuildDynamicMap.mockResolvedValue(fakeResult());

    const response = await createDynamicMapHandler()({ markers: [{ lat: 52.37, lon: 4.89 }] });

    expect(mockStoreVizData).toHaveBeenCalledTimes(1);
    expect(JSON.parse((response.content[1] as TextBlock).text)._meta.viz_id).toBe("viz-123");
  });

  it("does not cache the map state when show_ui is false, and says no map is shown", async () => {
    mockBuildDynamicMap.mockResolvedValue(fakeResult());

    const response = await createDynamicMapHandler()({
      markers: [{ lat: 52.37, lon: 4.89 }],
      show_ui: false,
    });

    expect(mockStoreVizData).not.toHaveBeenCalled();
    expect(JSON.parse((response.content[1] as TextBlock).text)).toEqual({
      _meta: { show_ui: false },
    });
    expect((response.content[0] as TextBlock).text).toContain("show_ui: false");
  });

  it("does not pass show_ui through to the map builder", async () => {
    mockBuildDynamicMap.mockResolvedValue(fakeResult());

    await createDynamicMapHandler()({ markers: [{ lat: 52.37, lon: 4.89 }], show_ui: true });

    expect(mockBuildDynamicMap).toHaveBeenCalledWith({ markers: [{ lat: 52.37, lon: 4.89 }] });
  });

  it("returns an error result when the map cannot be built", async () => {
    mockBuildDynamicMap.mockRejectedValue(new Error("Map requires content to display"));

    const response = await createDynamicMapHandler()({});

    expect(response.isError).toBe(true);
    expect(JSON.parse((response.content[0] as TextBlock).text)).toEqual({
      error: "Map requires content to display",
    });
    expect(mockStoreVizData).not.toHaveBeenCalled();
    expect(vi.mocked(logger.error)).toHaveBeenCalled();
  });
});

describe("describeDynamicMap", () => {
  it("lists each route plan with labels, distance in km and travel time", () => {
    const text = describeDynamicMap(
      fakeResult({
        markers: 4,
        routePlans: [
          {
            label: "Commute",
            originLabel: "Home",
            destinationLabel: "Office",
            travelMode: "car",
            waypointCount: 0,
            lengthInMeters: 12345,
            travelTimeInSeconds: 1500,
            trafficDelayInSeconds: 0,
          },
          {
            label: "Delivery",
            travelMode: "truck",
            waypointCount: 2,
            lengthInMeters: 502300,
            travelTimeInSeconds: 18720,
            trafficDelayInSeconds: 840,
          },
        ],
      }),
      true
    );

    expect(text).toContain("4 markers (including route start and end markers)");
    expect(text).toContain("2 calculated routes");
    expect(text).toContain("1. Commute (Home → Office): 12.3 km, 25 min by car");
    expect(text).toContain(
      "2. Delivery via 2 waypoints: 502.3 km, 5 h 12 min by truck (includes 14 min traffic delay)"
    );
  });

  it("reports a route plan that could not be calculated", () => {
    const text = describeDynamicMap(
      fakeResult({
        routePlans: [
          {
            label: "Route 1",
            destinationLabel: "Berlin",
            travelMode: "pedestrian",
            waypointCount: 0,
            error: "No route found",
          },
        ],
      }),
      true
    );

    expect(text).toContain(
      "1. Route 1 (origin → Berlin): could not calculate the route (No route found)"
    );
    expect(text).not.toContain(" km");
  });

  it("notes drawn lines that were not shown because route plans were given", () => {
    const text = describeDynamicMap(
      fakeResult({
        ignoredLines: 1,
        routePlans: [
          {
            label: "Route 1",
            travelMode: "car",
            waypointCount: 0,
            lengthInMeters: 1000,
            travelTimeInSeconds: 45,
          },
        ],
      }),
      true
    );

    expect(text).toContain(
      "1 drawn line from 'routes' was not shown because 'routePlans' were given."
    );
    expect(text).toContain("1.0 km, 45 s by car");
  });

  it("reports polygons and drawn lines", () => {
    const text = describeDynamicMap(fakeResult({ markers: 2, polygons: 1, lines: 1 }), true);
    expect(text).toContain(
      "2 markers (including route start and end markers), 1 polygon, 1 drawn line, 0 calculated routes"
    );
  });
});
