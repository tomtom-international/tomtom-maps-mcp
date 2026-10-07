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

import type { Position } from "geojson";
import { describe, expect, it } from "vitest";
import { getRoute } from "./routingService";

// Real tests using SDK — route responses are GeoJSON FeatureCollections
describe("Routing SDK Service", () => {
  // Positions as [longitude, latitude] (GeoJSON convention)
  const amsterdam: Position = [4.89707, 52.377956];
  const berlin: Position = [13.404954, 52.520008];
  const paris: Position = [2.352222, 48.856614];

  it("should calculate route from Amsterdam to Berlin", async (context) => {
    try {
      const result = await getRoute([amsterdam, berlin]);

      expect(result).toBeDefined();
      // SDK returns GeoJSON FeatureCollection
      expect(Array.isArray(result.features)).toBe(true);
      expect(result.features.length).toBeGreaterThan(0);

      const firstRoute = result.features[0];
      expect(firstRoute.properties?.summary).toBeDefined();
      expect(firstRoute.properties?.summary?.lengthInMeters).toBeGreaterThan(600000); // 600+ km
      expect(firstRoute.properties?.summary?.travelTimeInSeconds).toBeGreaterThan(20000); // 5+ hours
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("429")) {
        context.skip("TomTom API rate limit (429)");
      }
      throw error;
    }
  });

  it("should calculate route with custom routing options", async (context) => {
    try {
      const result = await getRoute([amsterdam, berlin], {
        routeType: "fast",
        travelMode: "car",
        traffic: "live",
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result.features)).toBe(true);
      expect(result.features.length).toBeGreaterThan(0);

      const firstRoute = result.features[0];
      expect(firstRoute.properties?.summary).toBeDefined();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("429")) {
        context.skip("TomTom API rate limit (429)");
      }
      throw error;
    }
  });

  it("should calculate a multi-stop route via intermediate waypoint", async (context) => {
    try {
      const result = await getRoute([amsterdam, berlin, paris]);

      expect(result).toBeDefined();
      expect(Array.isArray(result.features)).toBe(true);
      expect(result.features.length).toBeGreaterThan(0);

      const firstRoute = result.features[0];
      expect(firstRoute.properties?.summary).toBeDefined();
      // Multi-leg route: sections should reflect the stops
      expect(firstRoute.properties?.sections).toBeDefined();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("429")) {
        context.skip("TomTom API rate limit (429)");
      }
      throw error;
    }
  }, 15000); // Live cross-Europe route computation can exceed the 5s default

  it("should error when calculating route with fewer than 2 locations", async () => {
    await expect(getRoute([amsterdam])).rejects.toThrow(
      "At least two locations (origin and destination) are required"
    );
  });
});
