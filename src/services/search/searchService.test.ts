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

import type { GeocodingResponse, ReverseGeocodingResponse } from "@tomtom-org/maps-sdk/services";
import { describe, expect, it } from "vitest";
import { fuzzySearch, geocodeAddress, poiSearch, reverseGeocode } from "./searchService";

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
    expect(result.properties?.address).toBeDefined();
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
      position: [4.89707, 52.377956],
      radius: 5000,
      countries: ["NL"],
      language: "nl-NL",
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

  it("should handle fuzzy search with no options", async () => {
    const result = await fuzzySearch("Amsterdam");

    expect(result).toBeDefined();
    expect(Array.isArray(result.features)).toBe(true);
  });

  it("should handle geocoding with no results gracefully", async () => {
    const result = await geocodeAddress("ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ");

    expect(result.features).toEqual([]);
  });

  it("should handle reverse geocoding with unusual coordinates gracefully", async () => {
    await expect(reverseGeocode([0, 0])).resolves.toBeDefined(); // Null Island
  });

  it("should geocode an address with options", async () => {
    const result = (await geocodeAddress("Amsterdam Central Station", {
      limit: 3,
      position: [4.9, 52.37],
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
    expect(result.properties?.address).toBeTruthy();
  });
});
