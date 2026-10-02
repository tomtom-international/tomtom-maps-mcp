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

import { describe, it, expect } from "vitest";
import {
  poiSearch,
  searchNearby,
  fuzzySearch,
  reverseGeocode,
  geocodeAddress,
  searchEVStations,
} from "./searchService";

// Real tests using SDK — responses are GeoJSON FeatureCollections
describe("Search SDK Service", () => {
  it("should search for a city name (Amsterdam)", async () => {
    const result = await fuzzySearch("Amsterdam");

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

    expect(result.features.length).toBeGreaterThan(0);
  });

  it("should search for nearby points of interest", async () => {
    const result = await searchNearby([13.404954, 52.520008], {
      radius: 2000,
      poiCategories: ["RESTAURANT"],
    });

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

    expect(result.features.length).toBeGreaterThan(0);

    const firstFeature = result.features[0];
    expect(firstFeature.properties).toBeDefined();
    expect(firstFeature.geometry.coordinates).toBeDefined();
  });

  it("should perform reverse geocoding", async () => {
    const result = await reverseGeocode([4.89707, 52.377956]);

    // SDK reverseGeocode returns a single Place with properties.address
    expect(result.properties.address).toBeDefined();
    expect(result.geometry.coordinates).toBeDefined();
  });

  it("should geocode an address", async () => {
    const result = await geocodeAddress("Dam Square, Amsterdam");

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

    expect(result.features.length).toBeGreaterThan(0);
    for (const feature of result.features)
      expect(feature.properties.address.countryCode).toBe("NL");
  });

  it("should handle fuzzy search with bounding box", async () => {
    const result = await fuzzySearch("hotel", {
      boundingBox: [4.8, 52.3, 4.95, 52.4],
      limit: 3,
    });

    expect(result.features.length).toBeGreaterThan(0);
    for (const [lon, lat] of result.features.map((f) => f.geometry.coordinates)) {
      expect(lon).toBeGreaterThanOrEqual(4.8);
      expect(lon).toBeLessThanOrEqual(4.95);
      expect(lat).toBeGreaterThanOrEqual(52.3);
      expect(lat).toBeLessThanOrEqual(52.4);
    }
  });

  it("should find places nearby without a category filter", async () => {
    const result = await searchNearby([4.89707, 52.377956]);

    expect(result.features.length).toBeGreaterThan(0);
  });

  it("returns no features when geocoding finds nothing", async () => {
    const result = await geocodeAddress("ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ");

    expect(result.features).toEqual([]);
  });

  it("returns a feature without properties when reverse geocoding finds no address", async () => {
    const result = await reverseGeocode([0, 0]); // Null Island

    expect(result.geometry.coordinates).toEqual([0, 0]);
    expect(result.properties).toBeUndefined();
  });

  it("should geocode an address with options", async () => {
    const result = await geocodeAddress("Amsterdam Central Station", {
      countries: ["NL"],
      limit: 3,
      language: "nl-NL",
    });

    expect(result.features.length).toBeGreaterThan(0);
    expect(result.features[0].properties.address).toBeTruthy();
    expect(result.features[0].geometry.coordinates).toBeTruthy();
  });

  it("should reverse geocode with options", async () => {
    const result = await reverseGeocode([4.89707, 52.377956], {
      radius: 200,
      language: "nl-NL",
    });

    expect(result.properties.address).toBeTruthy();
  });

  it("returns only EV stations with a connector at or above minPowerKW", async () => {
    const result = await searchEVStations({
      position: [4.89707, 52.377956],
      radius: 1000,
      minPowerKW: 50,
      limit: 5,
      includeAvailability: false,
    });

    expect(result.features.length).toBeGreaterThan(0);
    for (const feature of result.features) {
      const connectors = feature.properties.chargingPark?.connectors ?? [];
      expect(connectors.some((c) => c.connector.ratedPowerKW >= 50)).toBe(true);
    }
  });
});
