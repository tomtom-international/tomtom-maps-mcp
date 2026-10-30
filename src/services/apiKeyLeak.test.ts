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

import type { Polygon, Position } from "geojson";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithSessionContext } from "./api-key";
import { getRoute } from "./routing/routingService";
import {
  fetchBoundaries,
  fetchPOICategories,
  fuzzySearch,
  geocodeAddress,
  geocodeAreas,
  poiSearch,
  resolveCategories,
  reverseGeocode,
  searchAlongRoute,
  searchInAreas,
} from "./search/searchService";
import { cannedApiResponse } from "./shared/cannedApiResponses";
import { getTrafficIncidents } from "./traffic/trafficService";

const FAKE_KEY = "fake-key-0123456789";

const amsterdam: Position = [4.89707, 52.377956];
const utrecht: Position = [5.12142, 52.090737];
const square: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [4.8, 52.3],
      [5.0, 52.3],
      [5.0, 52.45],
      [4.8, 52.45],
      [4.8, 52.3],
    ],
  ],
};

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
  ["fuzzySearch", () => fuzzySearch("coffee")],
  ["poiSearch", () => poiSearch("coffee")],
  ["geocodeAddress", () => geocodeAddress("Dam 1, Amsterdam")],
  ["reverseGeocode", () => reverseGeocode(amsterdam)],
  ["geocodeAreas", () => geocodeAreas("Amsterdam")],
  ["fetchBoundaries", () => fetchBoundaries(["boundary-1"])],
  ["fetchPOICategories", () => fetchPOICategories()],
  // Another language: the SDK caches the category list per language.
  [
    "resolveCategories",
    () => resolveCategories(["electric vehicle station"], { language: "nl-NL" }),
  ],
  ["searchInAreas", () => searchInAreas("coffee", [square])],
  [
    "searchAlongRoute",
    async () => {
      const [route] = (await getRoute([amsterdam, utrecht])).features;
      return searchAlongRoute("coffee", route, { maxDetourTimeSeconds: 600 });
    },
  ],
  ["getTrafficIncidents (bbox)", () => getTrafficIncidents([4.8, 52.3, 5.0, 52.45])],
  ["getTrafficIncidents (polygon)", () => getTrafficIncidents(square)],
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
