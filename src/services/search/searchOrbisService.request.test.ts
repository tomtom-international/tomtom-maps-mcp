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
import { geocodeAddress, reverseGeocode } from "./searchOrbisService";

vi.mock("../base/tomtomClient", () => ({ getEffectiveApiKey: () => "offline-test-key" }));

// Offline: stub fetch and inspect the URL the SDK builds, so these tests check that
// options reach the TomTom API rather than being dropped by the SDK's request builder.
describe("Search SDK Service request parameters", () => {
  let requestedUrls: URL[];

  beforeEach(() => {
    requestedUrls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        requestedUrls.push(new URL(input instanceof Request ? input.url : input.toString()));
        return new Response(JSON.stringify({ summary: {}, results: [], addresses: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function lastRequest(call: () => Promise<unknown>): Promise<URL> {
    await call().catch(() => undefined);
    expect(requestedUrls.length).toBeGreaterThan(0);
    return requestedUrls[requestedUrls.length - 1];
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
});
