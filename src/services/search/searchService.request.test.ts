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

import type { Route } from "@tomtom-org/maps-sdk/core";
import type { Polygon } from "geojson";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RecordedRequest, recordFetch } from "../shared/recordFetch";
import {
  fuzzySearch,
  geocodeAddress,
  geocodeAreas,
  poiSearch,
  reverseGeocode,
  searchAlongRoute,
  searchInAreas,
} from "./searchService";

vi.mock("../api-key", () => ({ requireApiKey: () => "offline-test-key" }));

// Offline: stub fetch and inspect the URL the SDK builds, so these tests check that
// options reach the TomTom API rather than being dropped by the SDK's request builder.
describe("Search SDK Service request parameters", () => {
  let requests: RecordedRequest[];

  beforeEach(() => {
    requests = recordFetch({ summary: {}, results: [], addresses: [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function lastRecorded(call: () => Promise<unknown>): Promise<RecordedRequest> {
    await call().catch(() => undefined);
    expect(requests.length).toBeGreaterThan(0);
    return requests[requests.length - 1];
  }

  async function lastRequest(call: () => Promise<unknown>): Promise<URL> {
    return (await lastRecorded(call)).url;
  }

  it("sends the geocode country filter", async () => {
    const url = await lastRequest(() => geocodeAddress("Main Street", { countries: ["NL", "BE"] }));

    expect(url.searchParams.get("countrySet")).toBe("NL,BE");
  });

  it("omits the geocode country filter when no countries are given", async () => {
    const url = await lastRequest(() => geocodeAddress("Main Street"));

    expect(url.searchParams.has("countrySet")).toBe(false);
  });

  it("sends the reverse geocode radius, heading and view", async () => {
    const url = await lastRequest(() =>
      reverseGeocode([4.89707, 52.377956], { radius: 250, heading: 90, view: "IN" })
    );

    expect(url.searchParams.get("radiusInMeters")).toBe("250");
    expect(url.searchParams.get("vehicleHeadingInDegrees")).toBe("90");
    expect(url.searchParams.get("geopoliticalView")).toBe("IN");
  });

  it.each([
    ["geocode", () => geocodeAddress("Main Street", { radius: 500 })],
    ["fuzzy search", () => fuzzySearch("coffee", { radius: 500 })],
    ["POI search", () => poiSearch("coffee", { radius: 500 })],
  ])("rejects a %s radius without a position before calling the API", async (_name, call) => {
    await expect(call()).rejects.toMatchObject({
      message: "radius needs position",
      data: { radius: 500 },
    });
    expect(requests).toHaveLength(0);
  });

  it.each([
    [
      "geocode",
      () =>
        geocodeAddress("Main Street", {
          position: [4.9, 52.37],
          boundingBox: [4.8, 52.3, 5.0, 52.4],
        }),
    ],
    [
      "fuzzy search",
      () => fuzzySearch("coffee", { position: [4.9, 52.37], boundingBox: [4.8, 52.3, 5.0, 52.4] }),
    ],
  ])("rejects a %s position with a bounding box before calling the API", async (_name, call) => {
    await expect(call()).rejects.toThrow("Give position or boundingBox, not both");
    expect(requests).toHaveLength(0);
  });

  it("rejects a reverse geocode entityType with heading, which it ignores", async () => {
    await expect(
      reverseGeocode([4.89707, 52.377956], { entityType: "Municipality", heading: 90 })
    ).rejects.toThrow("entityType ignores heading");
    expect(requests).toHaveLength(0);
  });

  // Reverse geocoding is on places API version 2, which takes the language as a header
  it("sends the reverse geocode language", async () => {
    const { headers } = await lastRecorded(() =>
      reverseGeocode([4.89707, 52.377956], { language: "nl-NL" })
    );

    expect(headers.get("Accept-Language")).toBe("nl-NL");
  });

  it("sends known POI categories", async () => {
    const url = await lastRequest(() =>
      poiSearch("dinner", { poiCategories: ["RESTAURANT"], position: [4.89707, 52.377956] })
    );

    expect(url.searchParams.get("categorySet")).toBe("7315");
  });

  it("rejects unknown POI categories with a short message before calling the API", async () => {
    await expect(poiSearch("dinner", { poiCategories: ["NOT_A_CATEGORY"] })).rejects.toMatchObject({
      message: "Unknown POI categories. Use tomtom-poi-categories to find valid category codes.",
      data: { unknown_categories: ["NOT_A_CATEGORY"] },
    });
    expect(requests).toHaveLength(0);
  });

  it("geocodes area names to areas only", async () => {
    const url = await lastRequest(() => geocodeAreas("Jordaan"));

    expect(url.searchParams.get("entityTypeSet")).toBe(
      "CountrySubdivision,CountrySecondarySubdivision,Municipality,MunicipalitySubdivision,Neighbourhood"
    );
  });

  it("searches every area in one geometry search", async () => {
    const square: Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [4.8, 52.3],
          [5.0, 52.3],
          [5.0, 52.45],
          [4.8, 52.3],
        ],
      ],
    };
    const { url, body } = await lastRecorded(() =>
      searchInAreas("cafe", [square, square], { language: "nl-NL" })
    );

    expect(requests).toHaveLength(1);
    expect(url.pathname).toContain("/geometrySearch/");
    expect(url.searchParams.get("language")).toBe("nl-NL");
    expect(JSON.parse(body).geometryList).toHaveLength(2);
  });

  it("sends the along-route detour budget and ordering", async () => {
    const route = {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [4.89707, 52.377956],
          [5.10962, 52.09083],
        ],
      },
      properties: {},
    } as unknown as Route;
    const { url, body } = await lastRecorded(() =>
      searchAlongRoute("fuel", route, { maxDetourTimeSeconds: 900, sortBy: "detourOffset" })
    );

    expect(url.pathname).toContain("/searchAlongRoute/");
    expect(url.searchParams.get("maxDetourTime")).toBe("900");
    expect(url.searchParams.get("sortBy")).toBe("detourOffset");
    expect(JSON.parse(body).route.points).toHaveLength(2);
  });
});
