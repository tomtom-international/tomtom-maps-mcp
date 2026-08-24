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

import type { BBox, Routes } from "@tomtom-org/maps-sdk/core";
import type { Position } from "geojson";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderDynamicMap } from "./dynamicMapService";

/** Minimal routing SDK response: one route feature over the given [lon, lat] positions. */
function makeRouteCollection(coordinates: Position[]): Routes {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "route-0",
        geometry: { type: "LineString", coordinates },
        properties: {
          index: 0,
          summary: {
            lengthInMeters: 1000,
            travelTimeInSeconds: 300,
            trafficDelayInSeconds: 0,
            departureTime: new Date("2025-01-01T10:00:00Z"),
            arrivalTime: new Date("2025-01-01T10:05:00Z"),
          },
          sections: {},
        },
      },
    ],
  } as unknown as Routes;
}

vi.mock("../base/tomtomClient", () => ({
  validateApiKey: vi.fn(),
  getEffectiveApiKey: vi.fn().mockReturnValue("test-api-key"),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("Dynamic Map Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("renderDynamicMap", () => {
    it("should build map state for markers", async () => {
      const result = await renderDynamicMap({
        markers: [{ lat: 52.374, lon: 4.8897, label: "Amsterdam", color: "#ff0000" }],
        width: 600,
        height: 400,
      });

      expect(result).toMatchObject({ width: 600, height: 400 });
      expect(result.mapState.sources.markers).toBeDefined();
      expect(result.mapState.layers.length).toBeGreaterThan(0);
    });

    it("should point the app at the Orbis vector style and a fitted viewport", async () => {
      const result = await renderDynamicMap({
        markers: [{ lat: 52.374, lon: 4.8897 }],
      });

      expect(result.mapState.style.endpoint).toContain("maps/orbis/assets/styles");
      expect(result.mapState.view.center).toHaveLength(2);
      expect(result.mapState.view.zoom).toBeGreaterThanOrEqual(0);
      expect(result.mapState.view.zoom).toBeLessThanOrEqual(22);
      expect(result.mapState.view.bounds).toBeDefined();
    });

    it("should handle route planning mode with routePlans", async () => {
      const routingModule = await import("../routing/routingService");
      vi.spyOn(routingModule, "getRoute").mockResolvedValue(
        makeRouteCollection([
          [4.8897, 52.374],
          [4.3517, 50.8503],
          [2.3522, 48.8566],
        ])
      );

      const result = await renderDynamicMap({
        routePlans: [
          {
            origin: { lat: 52.374, lon: 4.8897 },
            destination: { lat: 48.8566, lon: 2.3522 },
            waypoints: [{ lat: 50.8503, lon: 4.3517 }],
            label: "Amsterdam to Paris",
          },
        ],
      });

      expect(result.mapState.sources.routes).toBeDefined();
      // Origin, waypoint and destination are passed as [lon, lat] locations
      expect(routingModule.getRoute).toHaveBeenCalledWith(
        [
          [4.8897, 52.374],
          [4.3517, 50.8503],
          [2.3522, 48.8566],
        ],
        expect.anything()
      );
    });

    it("should throw error when no content is provided", async () => {
      await expect(renderDynamicMap({})).rejects.toThrow("Map requires content to display");
    });

    it("should apply default options", async () => {
      const result = await renderDynamicMap({
        markers: [{ lat: 52.374, lon: 4.8897 }],
      });

      expect(result.width).toBe(600); // Default
      expect(result.height).toBe(400); // Default
    });

    it("should honour the requested viewport without capping it", async () => {
      const result = await renderDynamicMap({
        markers: [{ lat: 52.374, lon: 4.8897 }],
        width: 2000,
        height: 2000,
      });

      expect(result.width).toBe(2000);
      expect(result.height).toBe(2000);
    });

    it("should handle intelligent route calculation with per-plan options", async () => {
      const routingModule = await import("../routing/routingService");
      vi.spyOn(routingModule, "getRoute").mockResolvedValue(
        makeRouteCollection([
          [4.8897, 52.374],
          [4.9, 52.368],
          [4.895, 52.365],
        ])
      );

      const result = await renderDynamicMap({
        routePlans: [
          {
            origin: { lat: 52.374, lon: 4.8897 },
            destination: { lat: 52.365, lon: 4.895 },
            routeType: "short" as const,
            travelMode: "car" as const,
            traffic: true,
            avoid: ["tollRoads"],
          },
        ],
      });

      expect(result.mapState.sources.routes).toBeDefined();
      expect(routingModule.getRoute).toHaveBeenCalledWith(
        [
          [4.8897, 52.374],
          [4.895, 52.365],
        ],
        {
          routeType: "short",
          travelMode: "car",
          avoid: ["tollRoads"],
          traffic: "live",
        }
      );
    });

    it("should default routeType/travelMode and omit traffic when a plan sets nothing", async () => {
      const routingModule = await import("../routing/routingService");
      vi.spyOn(routingModule, "getRoute").mockResolvedValue(
        makeRouteCollection([
          [4.8897, 52.374],
          [4.895, 52.365],
        ])
      );

      await renderDynamicMap({
        routePlans: [
          { origin: { lat: 52.374, lon: 4.8897 }, destination: { lat: 52.365, lon: 4.895 } },
        ],
      });

      expect(routingModule.getRoute).toHaveBeenCalledWith(expect.anything(), {
        routeType: "fast",
        travelMode: "car",
      });
    });

    it("should keep building state when a route plan fails", async () => {
      const routingModule = await import("../routing/routingService");
      vi.spyOn(routingModule, "getRoute").mockRejectedValue(new Error("Routing unavailable"));

      const result = await renderDynamicMap({
        markers: [{ lat: 52.374, lon: 4.8897 }],
        routePlans: [
          { origin: { lat: 52.374, lon: 4.8897 }, destination: { lat: 52.365, lon: 4.895 } },
        ],
      });

      expect(result.mapState.sources.markers).toBeDefined();
      expect(result.mapState.sources.routes).toBeUndefined();
    });
  });

  describe("Viewport selection", () => {
    it("should throw error when only center and zoom are provided without content", async () => {
      await expect(
        renderDynamicMap({
          center: { lat: 37.7749, lon: -122.4194 },
          zoom: 12,
          width: 800,
          height: 600,
        })
      ).rejects.toThrow("Map requires content to display");
    });

    it("should accept bbox with markers to constrain map bounds", async () => {
      const result = await renderDynamicMap({
        bbox: [-122.5, 37.7, -122.3, 37.8] as BBox,
        markers: [{ lat: 37.75, lon: -122.4 }],
        width: 800,
        height: 600,
      });

      expect(result.mapState.view.bounds).toBeDefined();
      expect(result.mapState.sources.markers).toBeDefined();
    });

    it("should build polygon sources and their centre labels", async () => {
      const result = await renderDynamicMap({
        polygons: [
          {
            type: "polygon" as const,
            coordinates: [
              [4.88, 52.37],
              [4.88, 52.38],
              [4.9, 52.38],
              [4.9, 52.37],
            ] as Array<[number, number]>,
            label: "Zone A",
          },
        ],
      });

      expect(result.mapState.sources.polygons).toBeDefined();
      expect(result.mapState.sources.polygonCenters).toBeDefined();
    });
  });
});
