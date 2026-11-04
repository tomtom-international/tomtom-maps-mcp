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
import type { DatasetTool } from "../../../services/datasets/dataset-store";

const mockFuzzySearch = vi.fn();

vi.mock("../../../services/search/searchService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/search/searchService")>()),
  fuzzySearch: mockFuzzySearch,
}));
vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { resolveDrive, resolveLocationInput, resolveLocationInputs } = await import(
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

const { clearDatasetStore, storeDataset } = await import(
  "../../../services/datasets/dataset-store"
);

describe("resolveLocationInput from a dataset", () => {
  const provenance = { tool: "tomtom-discover-places" as const, params: {} };
  const store = (...features: unknown[]) =>
    storeDataset({ type: "FeatureCollection", features }, provenance);

  beforeEach(() => {
    vi.clearAllMocks();
    clearDatasetStore();
  });

  it("reuses a place from a dataset instead of searching for it again", async () => {
    const { id } = store(feature(5.1, 52.09, "Fastned Utrecht"));

    expect(await resolveLocationInput({ dataset_id: id })).toEqual({
      position: [5.1, 52.09],
      name: "Fastned Utrecht",
    });
    expect(mockFuzzySearch).not.toHaveBeenCalled();
  });

  it("picks a feature by index", async () => {
    const { id } = store(feature(1, 1, "first"), feature(2, 2, "second"));

    expect((await resolveLocationInput({ dataset_id: id, featureIndex: 1 })).name).toBe("second");
  });

  it("says how many features a dataset holds when the index is out of range", async () => {
    const { id } = store(feature(1, 1));

    await expect(resolveLocationInput({ dataset_id: id, featureIndex: 7 })).rejects.toMatchObject({
      message: expect.stringContaining("describe-dataset"),
      data: { dataset_id: id, featureIndex: 7, featureCount: 1 },
    });
  });

  it("explains a dataset that is not available", async () => {
    await expect(resolveLocationInput({ dataset_id: "ds_gone" })).rejects.toMatchObject({
      message: expect.stringContaining("Re-run the tool"),
      data: { dataset_id: "ds_gone" },
    });
  });

  it("takes the first vertex of a route", async () => {
    const { id } = store({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [4, 52],
          [5, 53],
        ],
      },
      properties: { summary: {} },
    });

    expect(await resolveLocationInput({ dataset_id: id })).toEqual({
      position: [4, 52],
      name: `${id}[0]`,
    });
  });

  it("takes the first vertex of a MultiPolygon, such as a located boundary", async () => {
    const square = (west: number) => [
      [
        [west, 52],
        [west + 0.1, 52],
        [west + 0.1, 52.1],
        [west, 52],
      ],
    ];
    const { id } = store({
      type: "Feature",
      geometry: { type: "MultiPolygon", coordinates: [square(4.8), square(5)] },
      properties: { boundaryOf: "Amsterdam" },
    });

    expect((await resolveLocationInput({ dataset_id: id })).position).toEqual([4.8, 52]);
  });
});

describe("resolveDrive from a dataset", () => {
  const line = {
    type: "LineString",
    coordinates: [
      [4, 52],
      [4, 52.1],
    ],
  };
  const planned = {
    type: "Feature",
    geometry: line,
    properties: { summary: { lengthInMeters: 11_200, travelTimeInSeconds: 600 }, sections: {} },
  };
  const store = (tool: DatasetTool, feature: unknown) =>
    storeDataset({ type: "FeatureCollection", features: [feature] }, { tool, params: {} });
  const noRoute = "No route.";

  beforeEach(() => {
    clearDatasetStore();
  });

  it("follows a planned route as planned, with its routes for the map", async () => {
    const { id } = store("tomtom-plan-route", planned);

    const { drive, routes, label } = await resolveDrive({ dataset_id: id }, noRoute);

    expect(drive.properties.summary).toEqual({ lengthInMeters: 11_200, travelTimeInSeconds: 600 });
    expect(routes?.features).toHaveLength(1);
    expect(label).toBe(`the route in ${id}`);
  });

  // A derived cut of a route keeps the route's properties, whose indexes no longer fit it.
  it("measures any other line by its length alone, with no driving times", async () => {
    const { id } = store("tomtom-derive-datasets", planned);

    const { drive, routes } = await resolveDrive({ dataset_id: id }, noRoute);

    expect(drive.properties.summary.lengthInMeters).toBeCloseTo(11_120, -2);
    expect(drive.properties.summary.travelTimeInSeconds).toBeUndefined();
    expect(routes).toBeUndefined();
  });

  it("refuses a dataset whose first feature is not a line", async () => {
    const { id } = store("tomtom-discover-places", feature(4, 52));

    await expect(resolveDrive({ dataset_id: id }, noRoute)).rejects.toMatchObject({
      message: expect.stringContaining("not a line"),
      data: { dataset_id: id },
    });
  });

  it("takes the drive from locations or a dataset, not both or neither", async () => {
    const { id } = store("tomtom-plan-route", planned);
    const locations = [{ position: [4, 52] }, { position: [5, 52] }];

    await expect(resolveDrive({ locations, dataset_id: id }, noRoute)).rejects.toThrow(
      "either `locations` or a route's `dataset_id`"
    );
    await expect(resolveDrive({}, noRoute)).rejects.toThrow("either `locations`");
  });
});
