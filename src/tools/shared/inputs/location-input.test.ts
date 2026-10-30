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

const mockFuzzySearch = vi.fn();

vi.mock("../../../services/search/searchService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/search/searchService")>()),
  fuzzySearch: mockFuzzySearch,
}));
vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { locationInputSchema, resolveLocationInput, resolveLocationInputs } = await import(
  "./location-input"
);

const feature = (lng: number, lat: number, name?: string, municipality?: string) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lng, lat] },
  properties: {
    ...(name && { poi: { name } }),
    ...(municipality && { address: { municipality } }),
  },
});

describe("locationInputSchema", () => {
  it("takes a location sent as a JSON string", () => {
    expect(locationInputSchema.parse('{"position":[4.47,51.92]}')).toEqual({
      position: [4.47, 51.92],
    });
    expect(locationInputSchema.parse('{"query":"Rotterdam"}')).toEqual({ query: "Rotterdam" });
  });

  it("names both shapes when an input is neither", () => {
    for (const input of ["Rotterdam", { name: "Rotterdam" }]) {
      expect(locationInputSchema.safeParse(input).error?.issues[0].message).toBe(
        "A location is an object: { query } or { position: [longitude, latitude] }."
      );
    }
  });
});

describe("resolveLocationInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes an explicit position straight through", async () => {
    const result = await resolveLocationInput({ position: [4.9, 52.37] });
    expect(result).toEqual({ position: [4.9, 52.37], name: "4.9, 52.37" });
    // No lookup: the whole point of accepting coordinates.
    expect(mockFuzzySearch).not.toHaveBeenCalled();
  });

  it("resolves a name with one search", async () => {
    mockFuzzySearch.mockResolvedValue({ features: [feature(4.9, 52.378, "Amsterdam Centraal")] });

    const result = await resolveLocationInput({ query: "Amsterdam Centraal" });

    expect(result).toMatchObject({ position: [4.9, 52.378], name: "Amsterdam Centraal" });
    expect(mockFuzzySearch).toHaveBeenCalledTimes(1);
  });

  it("takes the candidate in the area the query names", async () => {
    mockFuzzySearch.mockResolvedValue({
      features: [
        feature(5.23, 52.09, "Damrak", "Zeist"),
        feature(4.89, 52.37, "Damrak 1", "Amsterdam"),
      ],
    });

    const result = await resolveLocationInput({ query: "Damrak 1, Amsterdam" });

    expect(result.position).toEqual([4.89, 52.37]);
  });

  // A route to the wrong country is worse than a refusal the model can act on.
  it("refuses a match outside the area the query names", async () => {
    mockFuzzySearch.mockResolvedValue({ features: [feature(5.23, 52.09, "Damrak", "Zeist")] });

    await expect(resolveLocationInput({ query: "Damrak 1, Amsterdam" })).rejects.toMatchObject({
      message: expect.stringContaining("Could not resolve the query"),
      data: { query: "Damrak 1, Amsterdam" },
    });
  });
});

describe("resolveLocationInputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves an ordered list", async () => {
    mockFuzzySearch
      .mockResolvedValueOnce({ features: [feature(4.9, 52.378, "Centraal")] })
      .mockResolvedValueOnce({ features: [feature(4.885, 52.36, "Rijksmuseum")] });

    const result = await resolveLocationInputs([
      { query: "Amsterdam Centraal" },
      { query: "Rijksmuseum" },
    ]);

    expect(result.map((location) => location.name)).toEqual(["Centraal", "Rijksmuseum"]);
  });

  it("names which entry failed, and stops there", async () => {
    mockFuzzySearch
      .mockResolvedValueOnce({ features: [feature(1, 1, "ok")] })
      .mockResolvedValueOnce({ features: [] });

    const resolving = resolveLocationInputs(
      [{ query: "a" }, { query: "b" }, { query: "c" }],
      "waypoint"
    );

    await expect(resolving).rejects.toMatchObject({
      data: { query: "b", failedInput: "waypoint 2 of 3" },
    });
    // Sequential: entry 3 was never looked up.
    expect(mockFuzzySearch).toHaveBeenCalledTimes(2);
  });
});
