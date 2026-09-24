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

// Offline: the Orbis tools expose openingHours, timeZone, mapcodes and
// extendedPostalCodesFor, so the service must send them to the API (#285).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runWithSessionContext } from "../base/tomtomClient";
import {
  fuzzySearch,
  poiSearch,
  searchNearby,
  geocodeAddress,
  reverseGeocode,
} from "./searchOrbisService";

const searchResponse = {
  summary: {
    query: "q",
    queryType: "NON_NEAR",
    queryTime: 1,
    numResults: 0,
    offset: 0,
    totalResults: 0,
    fuzzyLevel: 1,
    queryIntent: [],
  },
  results: [],
};

const reverseResponse = {
  summary: { queryTime: 1, numResults: 1 },
  addresses: [{ address: { freeformAddress: "Dam 1, Amsterdam" }, position: "52.373,4.8932" }],
};

let requested: URL[] = [];

beforeEach(() => {
  requested = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requested.push(url);
      const body = url.pathname.includes("reverseGeocode") ? reverseResponse : searchResponse;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const withKey = <T>(fn: () => Promise<T>) =>
  runWithSessionContext("fake-key", "tomtom-orbis-maps", fn);

const sentParams = () => {
  expect(requested).toHaveLength(1);
  return requested[0].searchParams;
};

const extras = {
  openingHours: "nextSevenDays",
  timeZone: "iana",
  mapcodes: ["Local", "International"],
  extendedPostalCodesFor: "POI, PAD",
  relatedPois: "child",
};

describe("Orbis search forwards requested optional fields", () => {
  it.each([
    ["fuzzySearch", () => fuzzySearch("coffee", { ...extras, position: [4.9, 52.37] })],
    ["poiSearch", () => poiSearch("restaurant", { ...extras, position: [4.9, 52.37] })],
    ["searchNearby", () => searchNearby([4.9, 52.37], { ...extras, radius: 500 })],
  ])(
    "%s sends openingHours, timeZone, mapcodes, extendedPostalCodesFor and relatedPois",
    async (_, call) => {
      await withKey(call);
      const params = sentParams();
      expect(params.get("relatedPois")).toBe("child");
      expect(params.get("openingHours")).toBe("nextSevenDays");
      expect(params.get("timeZone")).toBe("iana");
      expect(params.get("mapcodes")).toBe("Local,International");
      expect(params.get("extendedPostalCodesFor")).toBe("POI,PAD");
    }
  );

  it("geocodeAddress sends mapcodes and extendedPostalCodesFor", async () => {
    await withKey(() =>
      geocodeAddress("Dam 1, Amsterdam", {
        mapcodes: ["Local"],
        extendedPostalCodesFor: "PAD,Addr",
      })
    );
    const params = sentParams();
    expect(params.get("mapcodes")).toBe("Local");
    expect(params.get("extendedPostalCodesFor")).toBe("PAD,Addr");
  });

  it("reverseGeocode sends mapcodes", async () => {
    await withKey(() => reverseGeocode([4.8932, 52.373], { mapcodes: ["Local"] }));
    expect(sentParams().get("mapcodes")).toBe("Local");
  });

  it("sends none of them when not requested", async () => {
    await withKey(() => fuzzySearch("coffee", { mapcodes: [] }));
    const params = sentParams();
    for (const name of [
      "openingHours",
      "timeZone",
      "mapcodes",
      "extendedPostalCodesFor",
      "relatedPois",
    ]) {
      expect(params.has(name), name).toBe(false);
    }
  });
});
