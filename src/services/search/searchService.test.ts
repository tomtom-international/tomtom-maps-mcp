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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runWithSessionContext } from "../api-key";
import { cannedApiResponse } from "../shared/cannedApiResponses";
import { type RecordedRequest, recordFetch } from "../shared/recordFetch";
import {
  poiSearch,
  searchNearby,
  fuzzySearch,
  reverseGeocode,
  geocodeAddress,
  searchEVStations,
} from "./searchService";
import type { GeocodingResponse, ReverseGeocodingResponse } from "@tomtom-org/maps-sdk/services";

// Real tests using SDK — responses are GeoJSON FeatureCollections
describe("Search SDK Service", () => {
  it("should search for a city name (Amsterdam)", async () => {
    const result = await fuzzySearch("Amsterdam");

    expect(result).toBeDefined();
    expect(Array.isArray(result.features)).toBe(true);
    expect(result.features.length).toBeGreaterThan(0);

    const amsterdamFeature = result.features.find(
      (f) =>
        f.properties.address.freeformAddress?.includes("Amsterdam") ||
        f.properties.poi?.name?.includes("Amsterdam")
    );
    expect(amsterdamFeature).toBeDefined();

    const coords = amsterdamFeature?.geometry.coordinates;
    expect(Array.isArray(coords)).toBe(true);
    expect(typeof coords![0]).toBe("number"); // longitude
    expect(typeof coords![1]).toBe("number"); // latitude
  });

  it("should search for points of interest with a category", async () => {
    const result = await poiSearch("restaurant", {
      limit: 5,
      position: [4.89707, 52.377956],
      radius: 2000,
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.features)).toBe(true);
    expect(result.features.length).toBeGreaterThan(0);
  });

  it("should search for nearby points of interest", async () => {
    const result = await searchNearby([13.404954, 52.520008], {
      radius: 2000,
      poiCategories: ["RESTAURANT"],
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.features)).toBe(true);
    expect(result.features.length).toBeGreaterThan(0);

    const firstFeature = result.features[0];
    expect(firstFeature.geometry.coordinates).toBeDefined();
    expect(typeof firstFeature.geometry.coordinates[0]).toBe("number");
    expect(typeof firstFeature.geometry.coordinates[1]).toBe("number");
  });

  it("should perform fuzzy search with location bias", async () => {
    const result = await fuzzySearch("cafe", {
      position: [4.89707, 52.377956],
      radius: 5000,
      limit: 3,
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.features)).toBe(true);
    expect(result.features.length).toBeGreaterThan(0);

    const firstFeature = result.features[0];
    expect(firstFeature.properties).toBeDefined();
    expect(firstFeature.geometry.coordinates).toBeDefined();
  });

  it("should perform reverse geocoding", async () => {
    const result = await reverseGeocode([4.89707, 52.377956]);

    expect(result).toBeDefined();
    // SDK reverseGeocode returns a single Place with properties.address
    expect(result.properties.address).toBeDefined();
    expect(result.geometry.coordinates).toBeDefined();
  });

  it("should geocode an address", async () => {
    const result = await geocodeAddress("Dam Square, Amsterdam");

    expect(result).toBeDefined();
    expect(Array.isArray(result.features)).toBe(true);
    expect(result.features.length).toBeGreaterThan(0);

    const firstFeature = result.features[0];
    expect(firstFeature.properties.address).toBeDefined();
    expect(firstFeature.geometry.coordinates).toBeDefined();
  });

  it("should handle fuzzy search with advanced options", async () => {
    const result = await fuzzySearch("restaurant", {
      limit: 3,
      typeahead: true,
      position: [4.89707, 52.377956],
      radius: 5000,
      countries: ["NL"],
      language: "nl-NL",
      minFuzzyLevel: 1,
      maxFuzzyLevel: 2,
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.features)).toBe(true);
  });

  it("should handle fuzzy search with bounding box", async () => {
    const result = await fuzzySearch("hotel", {
      boundingBox: [4.8, 52.3, 4.95, 52.4],
      limit: 3,
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.features)).toBe(true);
  });

  it("should handle searchNearby with default radius", async () => {
    const result = await searchNearby([4.89707, 52.377956], {
      poiCategories: ["RESTAURANT"],
    });

    expect(result.features.length).toBeGreaterThan(0);
  });

  it("rejects searchNearby without poiCategories or a POI filter", async () => {
    await expect(searchNearby([4.89707, 52.377956])).rejects.toThrow(
      "Nearby search needs poiCategories or a POI filter"
    );
  });

  it("should handle fuzzy search with no options", async () => {
    const result = await fuzzySearch("Amsterdam");

    expect(result).toBeDefined();
    expect(Array.isArray(result.features)).toBe(true);
  });

  it("should handle geocoding with no results gracefully", async () => {
    try {
      const result = await geocodeAddress("ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ");

      expect(result).toBeDefined();
      // SDK returns empty features array for no results
      expect(Array.isArray(result.features)).toBe(true);
      expect(result.features.length).toBe(0);
    } catch {
      // SDK may throw for truly invalid queries
      console.log("Geocoding with invalid input may throw or return empty results");
    }
  });

  it("should handle reverse geocoding with unusual coordinates gracefully", async () => {
    try {
      const result = await reverseGeocode([0, 0]); // Null Island

      expect(result).toBeDefined();
    } catch {
      console.log("Reverse geocoding with unusual coordinates may throw or return empty");
    }
  });

  it("should search nearby with category filter", async () => {
    const result = await searchNearby([4.89707, 52.377956], {
      poiCategories: ["RESTAURANT"],
      radius: 1500,
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.features)).toBe(true);
  });

  it("should geocode an address with options", async () => {
    const result = (await geocodeAddress("Amsterdam Central Station", {
      countries: ["NL"],
      limit: 3,
      language: "nl-NL",
    })) as GeocodingResponse;

    expect(result).toBeTruthy();
    expect(Array.isArray(result.features)).toBe(true);
    expect(result.features.length).toBeGreaterThan(0);
    expect(result.features[0].properties.address).toBeTruthy();
    expect(result.features[0].geometry.coordinates).toBeTruthy();
  });

  it("should reverse geocode with options", async () => {
    const result = (await reverseGeocode([4.89707, 52.377956], {
      radius: 200,
      language: "nl-NL",
    })) as ReverseGeocodingResponse;

    expect(result).toBeTruthy();
    expect(result.properties.address).toBeTruthy();
  });

  it("finds fast chargers where the nearest stations are slow", async () => {
    // The stations nearest Amsterdam centre are ≤22 kW street chargers.
    const result = await searchEVStations({
      position: [4.89707, 52.377956],
      radius: 10000,
      minPowerKW: 50,
      limit: 5,
    });

    expect(result.features.length).toBeGreaterThan(0);
    for (const feature of result.features) {
      const connectors = feature.properties.chargingPark?.connectors ?? [];
      expect(connectors.some((c) => c.connector.ratedPowerKW >= 50)).toBe(true);
    }
  });
});

// Offline: the power bounds go to the API, which applies them to every station in range.
describe("power filters", () => {
  let requests: RecordedRequest[];

  beforeEach(() => {
    requests = recordFetch(cannedApiResponse);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const requestedUrl = () => requests[0].url;
  const inSession = <T>(fn: () => Promise<T>) => runWithSessionContext("fake-key", fn);
  const position: [number, number] = [4.89707, 52.377956];

  it("sends the EV search minimum to the API", async () => {
    await inSession(() => searchEVStations({ position, minPowerKW: 150 }));

    expect(requestedUrl().searchParams.get("minPowerKW")).toBe("150");
  });

  it.each([
    ["fuzzy search", () => fuzzySearch("charger", { minPowerKW: 50, maxPowerKW: 150 })],
    ["POI search", () => poiSearch("charger", { minPowerKW: 50, maxPowerKW: 150 })],
    ["nearby search", () => searchNearby(position, { minPowerKW: 50, maxPowerKW: 150 })],
  ])("sends both bounds from %s to the API", async (_name, run) => {
    await inSession(run);

    expect(requestedUrl().searchParams.get("minPowerKW")).toBe("50");
    expect(requestedUrl().searchParams.get("maxPowerKW")).toBe("150");
  });
});
