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
// apiKey) into some parsed results. No service result may carry the key.
// Runs offline: fetch is stubbed with canned API responses.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Position } from "geojson";
import { runWithSessionContext } from "./base/tomtomClient";
import { cannedApiResponse } from "./shared/cannedApiResponses";
import { calculateEVRoute, getReachableRange, getRoute } from "./routing/routingService";
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
} from "./search/searchService";

const FAKE_KEY = "fake-key-0123456789";

const amsterdam: Position = [4.89707, 52.377956];
const utrecht: Position = [5.12142, 52.090737];

// Each request as URL + headers, so the test can confirm the fake key was sent.
const requests: string[] = [];

beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push(`${url} ${JSON.stringify(init?.headers ?? {})}`);
      return new Response(JSON.stringify(cannedApiResponse(url)), {
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
  return runWithSessionContext(FAKE_KEY, fn);
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
  ["fuzzySearch", () => fuzzySearch("coffee")],
  ["poiSearch", () => poiSearch("coffee")],
  ["geocodeAddress", () => geocodeAddress("Dam 1, Amsterdam")],
  ["reverseGeocode", () => reverseGeocode(amsterdam)],
  ["searchNearby", () => searchNearby(amsterdam, { brandSet: "Shell" })],
  ["fetchPOICategories", () => fetchPOICategories()],
  ["searchInArea", () => searchInArea({ query: "coffee", center: amsterdam, radius: 1000 })],
  ["searchEVStations", () => searchEVStations({ position: amsterdam, radius: 5000 })],
  [
    "searchAlongRoute",
    () => searchAlongRoute({ origin: amsterdam, destination: utrecht, query: "coffee" }),
  ],
];

describe("Service results never contain the API key (#283)", () => {
  it.each(calls)("%s", async (_name, call) => {
    const result = await withFakeKey(call);

    // Sanity: the call really went through the stubbed API with the fake key.
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.some((request) => request.includes(FAKE_KEY))).toBe(true);

    expectNoKey(result);
  });
});

function expectNoKey(result: unknown): void {
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain(FAKE_KEY);
  expect(serialized).not.toMatch(/"apiKey"/);
}
