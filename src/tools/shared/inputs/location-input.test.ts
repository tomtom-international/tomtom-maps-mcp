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

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPoiSearch = vi.fn();
const mockGeocode = vi.fn();

vi.mock("../../../services/search/searchService", () => ({
  poiSearch: mockPoiSearch,
  geocodeAddress: mockGeocode,
}));
vi.mock("../../../services/api-key", () => ({ getEffectiveApiKey: () => "key-test" }));
vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { resolveLocationInput, resolveLocationInputs } = await import("./location-input");

const feature = (lng: number, lat: number, name?: string) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lng, lat] },
  properties: name ? { poi: { name } } : {},
});

describe("resolveLocationInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes an explicit position straight through", async () => {
    const result = await resolveLocationInput({ position: [4.9, 52.37] });
    expect(result).toEqual({ value: { position: [4.9, 52.37], name: "4.9, 52.37" } });
    // No geocode: the whole point of accepting coordinates.
    expect(mockGeocode).not.toHaveBeenCalled();
    expect(mockPoiSearch).not.toHaveBeenCalled();
  });

  it("resolves a venue through the POI index", async () => {
    mockPoiSearch.mockResolvedValue({ features: [feature(4.9, 52.378, "Amsterdam Centraal")] });

    const result = await resolveLocationInput({ query: "Amsterdam Centraal", queryAs: "poi" });

    expect("value" in result && result.value.name).toBe("Amsterdam Centraal");
    expect(mockPoiSearch).toHaveBeenCalledWith("Amsterdam Centraal", { limit: 1 });
    expect(mockGeocode).not.toHaveBeenCalled();
  });

  it("resolves an address through the geocoder", async () => {
    mockGeocode.mockResolvedValue({ features: [feature(4.89, 52.37)] });

    const result = await resolveLocationInput({ query: "Damrak 1, Amsterdam", queryAs: "place" });

    expect("value" in result && result.value.position).toEqual([4.89, 52.37]);
    expect(mockGeocode).toHaveBeenCalled();
    expect(mockPoiSearch).not.toHaveBeenCalled();
  });

  it("suggests the other queryAs when a lookup finds nothing", async () => {
    mockPoiSearch.mockResolvedValue({ features: [] });
    const result = await resolveLocationInput({ query: "Damrak 1", queryAs: "poi" });
    expect("error" in result && result.error).toContain('queryAs: "place"');
  });
});

describe("resolveLocationInputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves an ordered list", async () => {
    mockPoiSearch
      .mockResolvedValueOnce({ features: [feature(4.9, 52.378, "Centraal")] })
      .mockResolvedValueOnce({ features: [feature(4.885, 52.36, "Rijksmuseum")] });

    const result = await resolveLocationInputs([
      { query: "Amsterdam Centraal", queryAs: "poi" },
      { query: "Rijksmuseum", queryAs: "poi" },
    ]);

    expect("value" in result && result.value.map((l) => l.name)).toEqual([
      "Centraal",
      "Rijksmuseum",
    ]);
  });

  it("names which entry failed, and stops there", async () => {
    mockPoiSearch
      .mockResolvedValueOnce({ features: [feature(1, 1, "ok")] })
      .mockResolvedValueOnce({ features: [] });

    const result = await resolveLocationInputs(
      [
        { query: "a", queryAs: "poi" },
        { query: "b", queryAs: "poi" },
        { query: "c", queryAs: "poi" },
      ],
      "waypoint"
    );

    expect("error" in result && result.error).toContain("waypoint 2 of 3");
    // Sequential: entry 3 was never looked up.
    expect(mockPoiSearch).toHaveBeenCalledTimes(2);
  });
});
