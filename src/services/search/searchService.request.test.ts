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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  geocodeAddress,
  poiSearch,
  reverseGeocode,
  searchAlongRoute,
  searchEVStations,
  searchInArea,
  toSearchArea,
} from "./searchService";

import { recordFetch, type RecordedRequest } from "../shared/recordFetch";

vi.mock("../base/tomtomClient", () => ({ requireApiKey: () => "offline-test-key" }));

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

  async function lastRequest(call: () => Promise<unknown>): Promise<URL> {
    await call().catch(() => undefined);
    expect(requests.length).toBeGreaterThan(0);
    return requests[requests.length - 1].url;
  }

  it("sends the geocode country filter", async () => {
    const url = await lastRequest(() => geocodeAddress("Main Street", { countries: ["NL", "BE"] }));

    expect(url.searchParams.get("countrySet")).toBe("NL,BE");
  });

  it("omits the geocode country filter when no countries are given", async () => {
    const url = await lastRequest(() => geocodeAddress("Main Street"));

    expect(url.searchParams.has("countrySet")).toBe(false);
  });

  it("sends the reverse geocode radius", async () => {
    const url = await lastRequest(() => reverseGeocode([4.89707, 52.377956], { radius: 250 }));

    expect(url.searchParams.get("radius")).toBe("250");
  });

  it("sends the reverse geocode language", async () => {
    const url = await lastRequest(() =>
      reverseGeocode([4.89707, 52.377956], { language: "nl-NL" })
    );

    expect(url.searchParams.get("language")).toBe("nl-NL");
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

  it("sends the EV connector filter", async () => {
    const url = await lastRequest(() =>
      searchEVStations({
        position: [4.89707, 52.377956],
        connectorTypes: ["IEC62196Type2CCS", "Chademo"],
        includeAvailability: false,
      })
    );

    expect(url.searchParams.get("connectorSet")).toBe("IEC62196Type2CCS,Chademo");
  });

  it("sends area search as a geometry search", async () => {
    const url = await lastRequest(() =>
      searchInArea({ query: "cafe", center: [4.89707, 52.377956], radius: 500, language: "nl-NL" })
    );

    expect(url.pathname).toContain("/geometrySearch/");
    expect(url.searchParams.get("language")).toBe("nl-NL");
  });

  it("calculates the search-along-route corridor with the requested route type", async () => {
    await searchAlongRoute({
      origin: [4.89707, 52.377956],
      destination: [5.10962, 52.09083],
      query: "fuel",
      routeType: "short",
    }).catch(() => undefined);

    expect(requests[0].url.pathname).toContain("/routing/");
    expect(JSON.parse(requests[0].body)).toMatchObject({ routeType: "short" });
  });
});

describe("toSearchArea", () => {
  const polygon = [
    [4.88, 52.37],
    [4.9, 52.37],
    [4.9, 52.38],
  ];

  it.each([
    [
      "a circle and a polygon",
      { center: [4.89, 52.37], radius: 500, polygon },
      "Give one search area",
    ],
    [
      "a center without a radius",
      { center: [4.89, 52.37], polygon },
      "center and radius go together",
    ],
    ["a radius without a center", { radius: 500 }, "center and radius go together"],
  ])("rejects %s", (_name, params, message) => {
    expect(() => toSearchArea(params)).toThrow(message);
  });

  it("closes an open polygon", () => {
    const area = toSearchArea({ polygon });
    expect(area?.kind === "polygon" && area.polygon.coordinates[0]).toEqual([
      ...polygon,
      polygon[0],
    ]);
  });

  it("turns the top-left and bottom-right corners into a rectangle", () => {
    const area = toSearchArea({
      boundingBox: [
        [4.8, 52.45],
        [4.95, 52.3],
      ],
    });
    expect(area?.kind === "boundingBox" && area.polygon.coordinates[0]).toEqual([
      [4.8, 52.3],
      [4.95, 52.3],
      [4.95, 52.45],
      [4.8, 52.45],
      [4.8, 52.3],
    ]);
  });
});
