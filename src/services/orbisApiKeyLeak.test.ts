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

// Regression guard for #283: the maps-sdk copies request params (including
// apiKey) into some parsed results. No Orbis service result may carry the key.
// Runs offline: fetch is stubbed with canned API responses.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Position } from "geojson";
import { runWithSessionContext } from "./base/tomtomClient";
import { calculateEVRoute, getReachableRange, getRoute } from "./routing/routingOrbisService";
import {
  fetchPOICategories,
  fuzzySearch,
  geocodeAddress,
  poiSearch,
  reverseGeocode,
  searchAlongRoute,
  searchEVStations,
  searchInArea,
  searchNearby,
  searchPlaces,
} from "./search/searchOrbisService";

const FAKE_KEY = "fake-orbis-key-0123456789";

const amsterdam: Position = [4.89707, 52.377956];
const utrecht: Position = [5.12142, 52.090737];

const routeResponse = {
  formatVersion: "0.0.12",
  routes: [
    {
      summary: {
        lengthInMeters: 45000,
        travelDurationInSeconds: 2700,
        trafficDelayDurationInSeconds: 0,
        trafficLengthInMeters: 0,
        departureTime: "2026-09-24T10:00:00+02:00",
        arrivalTime: "2026-09-24T10:45:00+02:00",
      },
      legs: [
        {
          summary: {
            lengthInMeters: 45000,
            travelDurationInSeconds: 2700,
            departureTime: "2026-09-24T10:00:00+02:00",
            arrivalTime: "2026-09-24T10:45:00+02:00",
          },
          path: { type: "LineString", coordinates: [amsterdam, [5.0, 52.2], utrecht] },
        },
      ],
      sections: {},
    },
  ],
};

const reachableRangeResponse = {
  formatVersion: "0.0.1",
  reachableRange: {
    center: { latitude: amsterdam[1], longitude: amsterdam[0] },
    boundary: [
      { latitude: 52.4, longitude: 4.8 },
      { latitude: 52.4, longitude: 5.0 },
      { latitude: 52.3, longitude: 5.0 },
      { latitude: 52.3, longitude: 4.8 },
    ],
  },
};

const searchResponse = {
  summary: {
    query: "coffee",
    queryType: "NON_NEAR",
    queryTime: 10,
    numResults: 1,
    offset: 0,
    totalResults: 1,
    fuzzyLevel: 1,
    queryIntent: [],
  },
  results: [
    {
      type: "POI",
      id: "poi-1",
      score: 1,
      position: { lat: amsterdam[1], lon: amsterdam[0] },
      address: { freeformAddress: "Dam 1, Amsterdam", countryCode: "NL" },
      poi: { name: "Test Place", categories: ["cafe"], classifications: [] },
      chargingPark: {
        connectors: [{ connectorType: "IEC62196Type2CCS", ratedPowerKW: 150, currentType: "DC" }],
      },
      dataSources: { chargingAvailability: { id: "avail-1" } },
    },
  ],
};

const reverseGeocodeResponse = {
  summary: { queryTime: 5, numResults: 1 },
  addresses: [
    {
      address: { freeformAddress: "Dam 1, Amsterdam", countryCode: "NL" },
      position: `${amsterdam[1]},${amsterdam[0]}`,
    },
  ],
};

const evAvailabilityResponse = {
  results: [
    {
      id: "avail-1",
      accessType: "Public",
      chargingStations: [
        {
          id: "station-1",
          chargingPoints: [
            {
              evseId: "evse-1",
              status: "Available",
              connectors: [{ id: "c-1", type: "IEC62196Type2CCS", ratedPowerKW: 150 }],
            },
          ],
        },
      ],
    },
  ],
};

const poiCategoriesResponse = {
  poiCategories: [
    { id: 7309, name: "Electric Vehicle Station", childCategoryIds: [], synonyms: [] },
  ],
};

function cannedBody(url: string): unknown {
  if (url.includes("calculateReachableRange")) return reachableRangeResponse;
  if (url.includes("/routing/")) return routeResponse;
  if (url.includes("chargingAvailability")) return evAvailabilityResponse;
  if (url.includes("reverseGeocode")) return reverseGeocodeResponse;
  if (url.includes("poiCategories")) return poiCategoriesResponse;
  return searchResponse;
}

// Each request as URL + headers, so the test can confirm the fake key was sent.
const requests: string[] = [];
// When set, the first request fails with this HTTP status.
let failFirstRequestWith: number | undefined;

beforeEach(() => {
  requests.length = 0;
  failFirstRequestWith = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push(`${url} ${JSON.stringify(init?.headers ?? {})}`);
      if (failFirstRequestWith !== undefined && requests.length === 1) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: failFirstRequestWith,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(cannedBody(url)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function withFakeKey<T>(fn: () => Promise<T>): Promise<T> {
  return runWithSessionContext(FAKE_KEY, "tomtom-orbis-maps", fn);
}

const calls: Array<[string, () => Promise<unknown>]> = [
  ["getRoute", () => getRoute([amsterdam, utrecht])],
  ["getReachableRange", () => getReachableRange(amsterdam, { timeBudgetInSec: 1800 })],
  [
    "calculateEVRoute",
    () =>
      calculateEVRoute({
        origin: amsterdam,
        destination: utrecht,
        currentChargePercent: 80,
        maxChargeKWH: 75,
      }),
  ],
  ["searchPlaces", () => searchPlaces("coffee")],
  ["fuzzySearch", () => fuzzySearch("coffee")],
  ["poiSearch", () => poiSearch("coffee")],
  ["geocodeAddress", () => geocodeAddress("Dam 1, Amsterdam")],
  ["reverseGeocode", () => reverseGeocode(amsterdam)],
  ["searchNearby", () => searchNearby(amsterdam)],
  ["fetchPOICategories", () => fetchPOICategories()],
  ["searchInArea", () => searchInArea({ query: "coffee", center: amsterdam, radius: 1000 })],
  ["searchEVStations", () => searchEVStations({ position: amsterdam, radius: 5000 })],
  [
    "searchAlongRoute",
    () => searchAlongRoute({ origin: amsterdam, destination: utrecht, query: "coffee" }),
  ],
];

describe("Orbis service results never contain the API key (#283)", () => {
  it.each(calls)("%s", async (_name, call) => {
    const result = await withFakeKey(call);

    // Sanity: the call really went through the stubbed API with the fake key.
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.some((request) => request.includes(FAKE_KEY))).toBe(true);

    expectNoKey(result);
  });

  it("getReachableRange single-range fallback", async () => {
    // A 403 makes calculateReachableRanges throw, so the service retries with
    // the singular calculateReachableRange.
    failFirstRequestWith = 403;
    const result = await withFakeKey(() => getReachableRange(amsterdam, { timeBudgetInSec: 1800 }));

    expect(requests.length).toBe(2);
    expect(result.features).toHaveLength(1);
    expectNoKey(result);
  });

  it("getReachableRange keeps the budget and origin the widget reads", async () => {
    const result = await withFakeKey(() => getReachableRange(amsterdam, { timeBudgetInSec: 1800 }));

    for (const feature of result.features) {
      expect(Object.keys(feature.properties).sort()).toEqual(["budget", "origin"]);
      expect(feature.properties.origin).toEqual(amsterdam);
    }
    expect(result.features.map((f) => f.properties.budget.value)).toEqual([60, 45, 30, 15]);
    expect(result.requestedBudgetValue).toBe(30);
  });
});

function expectNoKey(result: unknown): void {
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain(FAKE_KEY);
  expect(serialized).not.toMatch(/"apiKey"/);
}
