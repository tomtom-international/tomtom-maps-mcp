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

const mockGeocode = vi.fn();
const mockPoiSearch = vi.fn();

vi.mock("../../../services/search/searchService", () => ({
  geocodeAddress: mockGeocode,
  poiSearch: mockPoiSearch,
}));
vi.mock("../../../services/api-key", () => ({ getEffectiveApiKey: () => "key-test" }));
vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { resolveNearby, resolveWithin, describeAreas } = await import("./resolve-where");
const { clearDatasetStore, storeDataset } = await import(
  "../../../services/datasets/dataset-store"
);

const polygonFeature = (label = "poly") => ({
  type: "Feature",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [4, 52],
        [5, 52],
        [5, 53],
        [4, 52],
      ],
    ],
  },
  properties: { address: { freeformAddress: label } },
});

describe("resolveWithin", () => {
  // A route named through `dataset_ids` means the corridor ALONG it, never the
  // envelope AROUND it: Amsterdam to Berlin bboxes to most of two countries,
  // which is not an area anyone asking about that drive means.
  it("resolves a route dataset to a corridor rather than its envelope", async () => {
    const stored = storeDataset({
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [
                [4.89, 52.37],
                [6.0, 52.4],
                [13.4, 52.52],
              ],
            },
            properties: {},
          },
        ],
      },
      kind: "routes",
      provenance: { tool: "tomtom-plan-route", params: {} },
    });

    const result = await resolveWithin({ mode: "within", dataset_ids: [stored.id] } as never);

    expect("error" in result).toBe(false);
    const areas = (result as { value: { polygon?: unknown; source: string }[] }).value;
    expect(areas).toHaveLength(1);
    expect(areas[0].source).toBe("route");
    expect(areas[0].polygon).toBeTruthy();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    clearDatasetStore();
  });

  it("uses an explicit bounding box as-is", async () => {
    const result = await resolveWithin({ mode: "within", boundingBox: [4, 52, 5, 53] });
    expect("value" in result && result.value).toEqual([
      { bbox: [4, 52, 5, 53], source: "boundingBox" },
    ]);
    expect(mockGeocode).not.toHaveBeenCalled();
  });

  // The reason `queries` exists: a bbox for a neighbourhood returns half the city.
  it("prefers an area's boundary POLYGON over its bounding box", async () => {
    mockGeocode.mockResolvedValue({ features: [polygonFeature("De Jordaan, Amsterdam")] });

    const result = await resolveWithin({ mode: "within", queries: ["De Jordaan"] });

    expect("value" in result && result.value[0].polygon?.type).toBe("Polygon");
    expect("value" in result && result.value[0].label).toBe("De Jordaan, Amsterdam");
    expect("value" in result && result.value[0].query).toBe("De Jordaan");
  });

  it("falls back to a bbox when the match has no polygon", async () => {
    mockGeocode.mockResolvedValue({
      features: [
        { type: "Feature", bbox: [4, 52, 5, 53], geometry: { type: "Point" }, properties: {} },
      ],
    });
    const result = await resolveWithin({ mode: "within", queries: ["Amsterdam"] });
    expect("value" in result && result.value[0].bbox).toEqual([4, 52, 5, 53]);
  });

  it("unions every supplied field", async () => {
    mockGeocode.mockResolvedValue({ features: [polygonFeature()] });
    const result = await resolveWithin({
      mode: "within",
      boundingBox: [0, 0, 1, 1],
      queries: ["Amsterdam"],
      geometries: [{ type: "Polygon", coordinates: [] }],
    });
    expect("value" in result && result.value.map((a) => a.source).sort()).toEqual([
      "boundingBox",
      "geometry",
      "query",
    ]);
  });

  it("fails rather than silently widening when an area name resolves to nothing", async () => {
    mockGeocode.mockResolvedValue({ features: [] });
    const result = await resolveWithin({ mode: "within", queries: ["Atlantis"] });
    // Searching wherever the geocoder guessed would be worse than an error.
    expect("error" in result && result.error).toContain("Could not resolve");
    expect("error" in result && result.error).toContain("boundingBox");
  });

  it("redirects to nearby when a name resolves to a point, not an area", async () => {
    mockGeocode.mockResolvedValue({
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [4, 52] }, properties: {} },
      ],
    });
    const result = await resolveWithin({ mode: "within", queries: ["Dam Square 1"] });
    expect("error" in result && result.error).toContain('mode "nearby"');
  });

  it("reuses polygons already held in a dataset", async () => {
    const stored = storeDataset({
      data: { type: "FeatureCollection", features: [polygonFeature()] },
      kind: "ranges",
      provenance: { tool: "tomtom-find-reachable-areas", params: {} },
    });

    const result = await resolveWithin({ mode: "within", dataset_ids: [stored.id] });

    expect("value" in result && result.value[0].source).toBe("dataset");
    expect("value" in result && result.value[0].polygon?.type).toBe("Polygon");
  });

  it("explains a dataset that holds nothing searchable", async () => {
    const stored = storeDataset({
      data: { type: "FeatureCollection", features: [] },
      kind: "places",
      provenance: { tool: "tomtom-poi-search", params: {} },
    });
    const result = await resolveWithin({ mode: "within", dataset_ids: [stored.id] });
    expect("error" in result && result.error).toContain("no polygon or bounding box");
  });

  it("buffers a stored route into a corridor", async () => {
    const stored = storeDataset({
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [
                [4.9, 52.37],
                [4.95, 52.4],
                [5.1, 52.5],
              ],
            },
            properties: {},
          },
        ],
      },
      kind: "routes",
      provenance: { tool: "tomtom-plan-route", params: {} },
    });

    const result = await resolveWithin({
      mode: "within",
      route: { dataset_id: stored.id, widthMeters: 1000 },
    });

    // This is what search-along-route did, without recalculating the route.
    expect("value" in result && result.value[0].source).toBe("route");
    expect("value" in result && result.value[0].polygon?.type).toMatch(/Polygon/);
  });

  it("requires at least one field", async () => {
    const result = await resolveWithin({ mode: "within" });
    expect("error" in result && result.error).toContain("at least one of");
  });
});

describe("resolveNearby", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDatasetStore();
  });

  it("uses an explicit position and defaults the radius", async () => {
    const bias = await resolveNearby({ mode: "nearby", position: [4.9, 52.37] });
    expect("value" in bias && bias.value).toEqual({ position: [4.9, 52.37], radiusMeters: 1000 });
  });

  it("honours an explicit radius", async () => {
    const bias = await resolveNearby({ mode: "nearby", position: [0, 0], radiusMeters: 250 });
    expect("value" in bias && bias.value.radiusMeters).toBe(250);
  });

  it("resolves a query to a bias point", async () => {
    mockGeocode.mockResolvedValue({
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [4.9, 52.4] }, properties: {} },
      ],
    });
    mockPoiSearch.mockResolvedValue({ features: [] });
    const bias = await resolveNearby({ mode: "nearby", query: "Amsterdam Centraal" });
    expect("value" in bias && bias.value.position).toEqual([4.9, 52.4]);
  });

  it("takes the POI index's answer for a named landmark the geocoder misses", async () => {
    // A square, station or landmark lives in the POI index, not the address one.
    mockPoiSearch.mockResolvedValue({
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [4.893, 52.373] },
          properties: { poi: { name: "Dam Square" }, address: { municipality: "Amsterdam" } },
        },
      ],
    });
    mockGeocode.mockResolvedValue({ features: [] });
    const bias = await resolveNearby({ mode: "nearby", query: "Dam Square, Amsterdam" });
    expect("value" in bias && bias.value.position).toEqual([4.893, 52.373]);
  });

  // The regression this function was rewritten for: an unscoped index answers
  // "Dam Square, Amsterdam" with Mill Dam Place, Leesburg, Virginia.
  it("discards a candidate that contradicts the area the query named", async () => {
    mockPoiSearch.mockResolvedValue({ features: [] });
    mockGeocode.mockResolvedValue({
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-77.56, 39.11] },
          properties: {
            address: { freeformAddress: "Mill Dam Place, Leesburg, VA", country: "United States" },
          },
        },
      ],
    });
    const bias = await resolveNearby({ mode: "nearby", query: "Dam Square, Amsterdam" });
    expect("error" in bias && bias.error).toContain("Could not resolve");
  });

  // Reversed deliberately: widening produced results on the wrong continent
  // while the response still reported the scope it had been asked for.
  it("fails rather than searching unbiased when nothing resolves", async () => {
    mockGeocode.mockRejectedValue(new Error("upstream down"));
    mockPoiSearch.mockRejectedValue(new Error("upstream down"));
    const bias = await resolveNearby({ mode: "nearby", query: "nowhere" });
    expect("error" in bias && bias.error).toContain("Could not resolve");
  });
});

describe("describeAreas", () => {
  it("reports what was actually searched", () => {
    expect(
      describeAreas([{ label: "Amsterdam", source: "query" }, { source: "boundingBox" }])
    ).toBe("Amsterdam, boundingBox");
  });
});
