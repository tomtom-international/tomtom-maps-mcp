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

import type { Polygon, Position } from "geojson";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Upstream, ForbiddenError } from "../types/types";
import { getRoute } from "./routing/routingService";
import {
  fetchBoundaries,
  fetchPOICategories,
  fuzzySearch,
  geocodeAreas,
  resolveCategories,
  reverseGeocode,
  searchAlongRoute,
  searchInAreas,
} from "./search/searchService";
import { getTrafficIncidents } from "./traffic/trafficService";

vi.mock("./base/tomtomClient", () => ({
  tomtomCallParams: () => ({ apiKey: "offline-test-key" }),
}));

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

const calls: [string, Upstream, () => Promise<unknown>][] = [
  ["getRoute", "tomtom-routing", () => getRoute([amsterdam, utrecht])],
  ["fuzzySearch", "tomtom-search", () => fuzzySearch("coffee")],
  ["geocodeAreas", "tomtom-geocoding", () => geocodeAreas("Amsterdam")],
  ["reverseGeocode", "tomtom-reverse-geocoding", () => reverseGeocode(amsterdam)],
  ["fetchPOICategories", "tomtom-poi-categories", () => fetchPOICategories()],
  [
    "resolveCategories",
    "tomtom-poi-categories",
    () => resolveCategories(["electric vehicle station"], { language: "de-DE" }),
  ],
  ["fetchBoundaries", "tomtom-geometry-data", () => fetchBoundaries(["boundary-1"])],
  ["searchInAreas", "tomtom-search", () => searchInAreas("coffee", [square])],
  [
    "searchAlongRoute",
    "tomtom-search",
    () =>
      searchAlongRoute("coffee", [amsterdam, utrecht], {
        maxDetourTimeSeconds: 600,
        sortBy: "detourTime",
      }),
  ],
  [
    "getTrafficIncidents",
    "tomtom-traffic-incidents",
    () => getTrafficIncidents([4.85, 52.35, 4.95, 52.4]),
  ],
];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("A failed TomTom call names the upstream that failed", () => {
  it.each(calls)("%s", async (_name, upstream, call) => {
    await expect(call()).rejects.toThrow(ForbiddenError);
    await expect(call()).rejects.toMatchObject({ upstream });
  });
});
