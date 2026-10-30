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

vi.mock("../api-key", () => ({
  requireApiKey: vi.fn().mockReturnValue("test-api-key"),
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

      expect(result.mapState.options).toMatchObject({ width: 600, height: 400 });
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

      expect(result.mapState.options).toMatchObject({ width: 600, height: 400 });
    });

    it("should honour the requested viewport without capping it", async () => {
      const result = await renderDynamicMap({
        markers: [{ lat: 52.374, lon: 4.8897 }],
        width: 2000,
        height: 2000,
      });

      expect(result.mapState.options).toMatchObject({ width: 2000, height: 2000 });
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

    it("should default routeType/travelMode and use historical traffic when a plan sets nothing", async () => {
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
        traffic: "historical",
      });
    });

    it("should summarise the markers, routes and areas for the agent", async () => {
      const routingModule = await import("../routing/routingService");
      vi.spyOn(routingModule, "getRoute").mockResolvedValue(
        makeRouteCollection([
          [4.8897, 52.374],
          [4.895, 52.365],
        ])
      );

      const { summary, mapState } = await renderDynamicMap({
        markers: [{ lat: 52.37, lon: 4.89, label: "Cafe", category: "Restaurant" }],
        polygons: [{ type: "circle", center: { lat: 52.3, lon: 4.8 }, radius: 500, label: "Zone" }],
        routePlans: [
          {
            origin: { lat: 52.374, lon: 4.8897 },
            destination: { lat: 52.365, lon: 4.895 },
            label: "Commute",
          },
        ],
      });

      expect(summary.view).toEqual(mapState.view);
      expect(summary.markers).toContainEqual({
        label: "Cafe",
        position: [4.89, 52.37],
        category: "Restaurant",
      });
      expect(summary.routes).toEqual([
        {
          name: "Commute",
          distance: "1.0km",
          travelTime: "5m",
          lengthInMeters: 1000,
          travelTimeInSeconds: 300,
        },
      ]);
      expect(summary.areas).toEqual([{ label: "Zone" }]);
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

    it("should keep a center given without a zoom and fit the zoom", async () => {
      const result = await renderDynamicMap({
        center: { lat: 52.0, lon: 5.0 },
        markers: [{ lat: 52.37, lon: 4.89 }],
      });

      expect(result.mapState.view.center).toEqual([5.0, 52.0]);
    });

    it("should zoom out to keep the content in view around a distant center", async () => {
      const markers = [{ lat: 48.86, lon: 2.35 }];
      const fitted = await renderDynamicMap({ markers });
      const centered = await renderDynamicMap({ center: { lat: 52.37, lon: 4.89 }, markers });

      expect(centered.mapState.view.zoom).toBeLessThan(fitted.mapState.view.zoom);
      const { west, south, east, north } = centered.mapState.view.bounds;
      expect(west).toBeLessThan(2.35);
      expect(east).toBeGreaterThan(2.35);
      expect(south).toBeLessThan(48.86);
      expect(north).toBeGreaterThan(48.86);
    });

    it("should keep a zoom given without a center and fit the center", async () => {
      const result = await renderDynamicMap({
        zoom: 7,
        markers: [
          { lat: 52.37, lon: 4.89 },
          { lat: 52.09, lon: 5.12 },
        ],
      });

      expect(result.mapState.view.zoom).toBe(7);
      const [lon, lat] = result.mapState.view.center;
      expect(lon).toBeCloseTo(5.005, 1);
      expect(lat).toBeCloseTo(52.23, 1);
    });

    it("should draw direct routes alongside route plans", async () => {
      const routingModule = await import("../routing/routingService");
      vi.spyOn(routingModule, "getRoute").mockResolvedValue(
        makeRouteCollection([
          [4.8897, 52.374],
          [4.895, 52.365],
        ])
      );

      const result = await renderDynamicMap({
        routes: [
          {
            points: [
              { lat: 52.09, lon: 5.12 },
              { lat: 52.08, lon: 5.13 },
            ],
            name: "Direct",
          },
        ],
        routePlans: [
          { origin: { lat: 52.374, lon: 4.8897 }, destination: { lat: 52.365, lon: 4.895 } },
        ],
      });

      expect(result.mapState.sources.routes?.data.features).toHaveLength(2);
    });

    it("should keep a polygon stroke width of 0", async () => {
      const result = await renderDynamicMap({
        polygons: [
          { type: "circle", center: { lat: 52.36, lon: 4.9 }, radius: 500, strokeWidth: 0 },
        ],
      });

      const [polygon] = result.mapState.sources.polygons?.data.features ?? [];
      expect(polygon.properties?.strokeWidth).toBe(0);
    });

    it("should frame a bbox-only map on the bbox", async () => {
      const result = await renderDynamicMap({ bbox: [4.87, 52.355, 4.915, 52.385] });

      const [lon, lat] = result.mapState.view.center;
      expect(lon).toBeCloseTo(4.8925);
      expect(lat).toBeCloseTo(52.37);
      expect(result.mapState.sources).toEqual({});
    });

    it("should point every layer at a source it registers", async () => {
      const routingModule = await import("../routing/routingService");
      vi.spyOn(routingModule, "getRoute").mockResolvedValue(
        makeRouteCollection([
          [4.8897, 52.374],
          [4.895, 52.365],
        ])
      );

      const result = await renderDynamicMap({
        showLabels: true,
        markers: [{ lat: 52.37, lon: 4.89 }],
        polygons: [{ type: "circle", center: { lat: 52.36, lon: 4.9 }, radius: 500 }],
        routePlans: [
          { origin: { lat: 52.374, lon: 4.8897 }, destination: { lat: 52.365, lon: 4.895 } },
        ],
      });

      const sourceNames = Object.keys(result.mapState.sources);
      for (const layer of result.mapState.layers) {
        expect(sourceNames).toContain(layer.source);
      }
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
