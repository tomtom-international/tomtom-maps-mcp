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

import { describe, it, expect, vi, beforeEach } from "vitest";

// Create typed mocks
const mockStoreVizData = vi.fn();
const mockAxiosGet = vi.fn();
const mockLookup = vi.fn();
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock("axios", () => ({
  default: { get: mockAxiosGet },
}));

vi.mock("node:dns/promises", () => ({
  lookup: mockLookup,
}));

vi.mock("../services/cache/vizCache", () => ({
  storeVizData: mockStoreVizData,
}));

vi.mock("../utils/logger", () => ({
  logger: mockLogger,
}));

// Import after mocking
const { createDataVizHandler } = await import("./dataVizOrbisHandler");

// -- Helpers --

function makeFeatureCollection(features: unknown[]) {
  return JSON.stringify({ type: "FeatureCollection", features });
}

function makePointFeature(lng: number, lat: number, properties: Record<string, unknown> = {}) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties,
  };
}

const defaultLayers = [{ type: "markers" as const }];

describe("createDataVizHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreVizData.mockResolvedValue("test-viz-id");
  });

  // ---------------------------------------------------------------------------
  // Success paths
  // ---------------------------------------------------------------------------

  describe("success paths", () => {
    it("should process valid inline FeatureCollection and return summary", async () => {
      const geojson = makeFeatureCollection([
        makePointFeature(4.89, 52.37, { name: "Amsterdam", population: 900000 }),
        makePointFeature(5.12, 52.09, { name: "Utrecht", population: 360000 }),
      ]);

      const handler = createDataVizHandler();
      const response = await handler({ geojson, layers: defaultLayers });

      expect(response.isError).toBeUndefined();
      expect(response.content[0].type).toBe("text");
      const result = JSON.parse(response.content[0].text);
      expect(result.summary.feature_count).toBe(2);
      expect(result.summary.geometry_types).toEqual(["Point"]);
      // Verify exact property lists — not just .toContain
      expect(result.summary.property_names).toEqual(expect.arrayContaining(["name", "population"]));
      expect(result.summary.property_names).toHaveLength(2);
      expect(result.summary.numeric_properties).toEqual(["population"]);
      // Verify bbox element-by-element: [minLng, minLat, maxLng, maxLat]
      const [minLng, minLat, maxLng, maxLat] = result.summary.bbox;
      expect(minLng).toBe(4.89); // westmost longitude
      expect(minLat).toBe(52.09); // southmost latitude
      expect(maxLng).toBe(5.12); // eastmost longitude
      expect(maxLat).toBe(52.37); // northmost latitude
      expect(result.summary.sample_properties).toEqual({ name: "Amsterdam", population: 900000 });
      expect(result.layers_applied).toEqual(["markers"]);
      // Verify vizCache receives the full data including geojson, layers, title, bbox
      expect(mockStoreVizData).toHaveBeenCalledOnce();
      expect(mockStoreVizData).toHaveBeenCalledWith(
        expect.objectContaining({
          geojson: expect.objectContaining({ type: "FeatureCollection" }),
          layers: defaultLayers,
          bbox: [4.89, 52.09, 5.12, 52.37],
        })
      );
    });

    it("should normalize a single Feature to FeatureCollection", async () => {
      const geojson = JSON.stringify({
        type: "Feature",
        geometry: { type: "Point", coordinates: [4.89, 52.37] },
        properties: { name: "Amsterdam" },
      });

      const handler = createDataVizHandler();
      const response = await handler({ geojson, layers: defaultLayers });

      const result = JSON.parse(response.content[0].text);
      expect(result.summary.feature_count).toBe(1);
      expect(result.summary.geometry_types).toEqual(["Point"]);
    });

    it("should normalize a bare Geometry to FeatureCollection", async () => {
      const geojson = JSON.stringify({
        type: "Point",
        coordinates: [4.89, 52.37],
      });

      const handler = createDataVizHandler();
      const response = await handler({ geojson, layers: defaultLayers });

      const result = JSON.parse(response.content[0].text);
      expect(result.summary.feature_count).toBe(1);
      expect(result.summary.geometry_types).toEqual(["Point"]);
    });

    it("should fetch GeoJSON from data_url", async () => {
      mockLookup.mockResolvedValue({ address: "93.184.216.34", family: 4 });
      mockAxiosGet.mockResolvedValue({
        data: {
          type: "FeatureCollection",
          features: [makePointFeature(4.89, 52.37, { name: "Test" })],
        },
      });

      const handler = createDataVizHandler();
      const response = await handler({
        data_url: "https://example.com/data.geojson",
        layers: defaultLayers,
      });

      expect(mockAxiosGet).toHaveBeenCalledWith(
        "https://example.com/data.geojson",
        expect.objectContaining({ timeout: 30_000 })
      );
      const result = JSON.parse(response.content[0].text);
      expect(result.summary.feature_count).toBe(1);
    });

    it("should include multiple layers in layers_applied", async () => {
      const geojson = makeFeatureCollection([makePointFeature(4.89, 52.37)]);

      const handler = createDataVizHandler();
      const response = await handler({
        geojson,
        layers: [{ type: "heatmap" as const }, { type: "markers" as const }],
      });

      const result = JSON.parse(response.content[0].text);
      expect(result.layers_applied).toEqual(["heatmap", "markers"]);
    });

    it("should include viz_id in _meta when show_ui is true (default)", async () => {
      const geojson = makeFeatureCollection([makePointFeature(4.89, 52.37)]);

      const handler = createDataVizHandler();
      const response = await handler({ geojson, layers: defaultLayers });

      const result = JSON.parse(response.content[0].text);
      expect(result._meta.show_ui).toBe(true);
      expect(result._meta.viz_id).toBe("test-viz-id");
    });

    it("should include viz_id in _meta when show_ui is false", async () => {
      const geojson = makeFeatureCollection([makePointFeature(4.89, 52.37)]);

      const handler = createDataVizHandler();
      const response = await handler({ geojson, layers: defaultLayers, show_ui: false });

      const result = JSON.parse(response.content[0].text);
      expect(result._meta.show_ui).toBe(false);
      // viz_id is still generated (cache is still called)
      expect(result._meta.viz_id).toBe("test-viz-id");
    });

    it("should include title in response when provided", async () => {
      const geojson = makeFeatureCollection([makePointFeature(4.89, 52.37)]);

      const handler = createDataVizHandler();
      const response = await handler({
        geojson,
        layers: defaultLayers,
        title: "Store Locations",
      });

      const result = JSON.parse(response.content[0].text);
      expect(result.title).toBe("Store Locations");
    });

    it("should handle mixed geometry types", async () => {
      const geojson = JSON.stringify({
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: {} },
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
            properties: {},
          },
          {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 0],
                ],
              ],
            },
            properties: {},
          },
        ],
      });

      const handler = createDataVizHandler();
      const response = await handler({ geojson, layers: defaultLayers });

      const result = JSON.parse(response.content[0].text);
      expect(result.summary.geometry_types).toContain("Point");
      expect(result.summary.geometry_types).toContain("LineString");
      expect(result.summary.geometry_types).toContain("Polygon");
      expect(result.summary.bbox).toEqual([0, 0, 1, 1]);
    });
  });

  // ---------------------------------------------------------------------------
  // Validation errors
  // ---------------------------------------------------------------------------

  describe("validation errors", () => {
    it("should error when neither data_url nor geojson is provided", async () => {
      const handler = createDataVizHandler();
      const response = await handler({ layers: defaultLayers });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("data_url");
      expect(response.content[0].text).toContain("geojson");
    });

    it("should error when both data_url and geojson are provided", async () => {
      const handler = createDataVizHandler();
      const response = await handler({
        data_url: "https://example.com/data.geojson",
        geojson: makeFeatureCollection([makePointFeature(0, 0)]),
        layers: defaultLayers,
      });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("mutually exclusive");
    });

    it("should error when inline GeoJSON exceeds size limit", async () => {
      const oversized = "x".repeat(10 * 1024 * 1024 + 1);

      const handler = createDataVizHandler();
      const response = await handler({ geojson: oversized, layers: defaultLayers });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("too large");
    });

    it("should error when layer count exceeds 10", async () => {
      const geojson = makeFeatureCollection([makePointFeature(0, 0)]);
      const tooManyLayers = Array.from({ length: 11 }, () => ({ type: "markers" as const }));

      const handler = createDataVizHandler();
      const response = await handler({ geojson, layers: tooManyLayers });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Too many layers");
    });

    it("should error when choropleth layer lacks color_property", async () => {
      const geojson = makeFeatureCollection([makePointFeature(0, 0)]);

      const handler = createDataVizHandler();
      const response = await handler({
        geojson,
        layers: [{ type: "choropleth" as const }],
      });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("color_property");
    });

    it("should error when inline geojson is invalid JSON", async () => {
      const handler = createDataVizHandler();
      const response = await handler({ geojson: "{not valid json", layers: defaultLayers });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("failed to parse");
    });

    it("should error when GeoJSON has no features", async () => {
      const geojson = makeFeatureCollection([]);

      const handler = createDataVizHandler();
      const response = await handler({ geojson, layers: defaultLayers });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("no features");
    });

    it("should error when feature count exceeds 100K", async () => {
      // Create a FeatureCollection with more than MAX_FEATURES
      const features = Array.from({ length: 100_001 }, (_, i) => makePointFeature(i * 0.001, 0));
      const geojson = JSON.stringify({ type: "FeatureCollection", features });

      const handler = createDataVizHandler();
      const response = await handler({ geojson, layers: defaultLayers });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Too many features");
    });
  });

  // ---------------------------------------------------------------------------
  // GeoJSON normalization edge cases
  // ---------------------------------------------------------------------------

  describe("GeoJSON normalization", () => {
    it("should error when FeatureCollection is missing features array", async () => {
      const geojson = JSON.stringify({ type: "FeatureCollection" });

      const handler = createDataVizHandler();
      const response = await handler({ geojson, layers: defaultLayers });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("features");
    });

    it("should error for unknown GeoJSON type", async () => {
      const geojson = JSON.stringify({ type: "UnknownType" });

      const handler = createDataVizHandler();
      const response = await handler({ geojson, layers: defaultLayers });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("UnknownType");
    });

    it("should error when data is not an object", async () => {
      const geojson = JSON.stringify("just a string");

      const handler = createDataVizHandler();
      const response = await handler({ geojson, layers: defaultLayers });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("not an object");
    });
  });

  // ---------------------------------------------------------------------------
  // Bbox computation
  // ---------------------------------------------------------------------------

  describe("bbox computation", () => {
    it("should distinguish lng vs lat in bbox (asymmetric coordinates)", async () => {
      // Use coordinates where lng !== lat to catch coordinate swaps
      // Point at (lng=100, lat=5) — if swapped, bbox would be [5, 100, 100, 5]
      const geojson = makeFeatureCollection([makePointFeature(100, 5)]);

      const handler = createDataVizHandler();
      const response = await handler({ geojson, layers: defaultLayers });

      const result = JSON.parse(response.content[0].text);
      const [minLng, minLat, maxLng, maxLat] = result.summary.bbox;
      expect(minLng).toBe(100); // coord[0] = longitude
      expect(minLat).toBe(5); // coord[1] = latitude
      expect(maxLng).toBe(100);
      expect(maxLat).toBe(5);
    });

    it("should compute bbox across multiple features with negative coords", async () => {
      const geojson = makeFeatureCollection([
        makePointFeature(-74.006, 40.7128), // New York
        makePointFeature(2.3522, 48.8566), // Paris
      ]);

      const handler = createDataVizHandler();
      const response = await handler({ geojson, layers: defaultLayers });

      const result = JSON.parse(response.content[0].text);
      const [minLng, minLat, maxLng, maxLat] = result.summary.bbox;
      expect(minLng).toBe(-74.006);
      expect(minLat).toBe(40.7128);
      expect(maxLng).toBe(2.3522);
      expect(maxLat).toBe(48.8566);
    });

    it("should return null bbox when features have no coordinates", async () => {
      const geojson = JSON.stringify({
        type: "FeatureCollection",
        features: [{ type: "Feature", geometry: { type: "Point" }, properties: {} }],
      });

      const handler = createDataVizHandler();
      const response = await handler({ geojson, layers: defaultLayers });

      const result = JSON.parse(response.content[0].text);
      expect(result.summary.bbox).toBeNull();
    });

    it("should walk deeply nested MultiPolygon coordinates", async () => {
      // MultiPolygon has 4 levels of nesting: [polygon][ring][coord][lng,lat]
      const geojson = JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "MultiPolygon",
              coordinates: [
                [
                  [
                    [-10, -20],
                    [30, -20],
                    [30, 40],
                    [-10, 40],
                    [-10, -20],
                  ],
                ],
                [
                  [
                    [50, 60],
                    [70, 60],
                    [70, 80],
                    [50, 80],
                    [50, 60],
                  ],
                ],
              ],
            },
            properties: {},
          },
        ],
      });

      const handler = createDataVizHandler();
      const response = await handler({ geojson, layers: defaultLayers });

      const result = JSON.parse(response.content[0].text);
      const [minLng, minLat, maxLng, maxLat] = result.summary.bbox;
      expect(minLng).toBe(-10);
      expect(minLat).toBe(-20);
      expect(maxLng).toBe(70);
      expect(maxLat).toBe(80);
    });
  });

  // ---------------------------------------------------------------------------
  // Summary computation edge cases
  // ---------------------------------------------------------------------------

  describe("summary computation", () => {
    it("should not classify string-typed numbers as numeric properties", async () => {
      const geojson = makeFeatureCollection([
        makePointFeature(0, 0, { count: "123", value: 456, flag: true }),
      ]);

      const handler = createDataVizHandler();
      const response = await handler({ geojson, layers: defaultLayers });

      const result = JSON.parse(response.content[0].text);
      expect(result.summary.numeric_properties).toEqual(["value"]);
      expect(result.summary.numeric_properties).not.toContain("count");
      expect(result.summary.numeric_properties).not.toContain("flag");
    });

    it("should handle features with null properties", async () => {
      const geojson = JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: null,
          },
        ],
      });

      const handler = createDataVizHandler();
      const response = await handler({ geojson, layers: defaultLayers });

      const result = JSON.parse(response.content[0].text);
      expect(result.summary.feature_count).toBe(1);
      expect(result.summary.sample_properties).toBeNull();
      expect(result.summary.property_names).toEqual([]);
    });

    it("should take sample_properties from the first feature with properties", async () => {
      const geojson = JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: null,
          },
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [1, 1] },
            properties: { name: "Second" },
          },
        ],
      });

      const handler = createDataVizHandler();
      const response = await handler({ geojson, layers: defaultLayers });

      const result = JSON.parse(response.content[0].text);
      // First non-null properties should be sampled
      expect(result.summary.sample_properties).toEqual({ name: "Second" });
    });

    it("should return null title when title is not provided", async () => {
      const geojson = makeFeatureCollection([makePointFeature(0, 0)]);

      const handler = createDataVizHandler();
      const response = await handler({ geojson, layers: defaultLayers });

      const result = JSON.parse(response.content[0].text);
      expect(result.title).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Boundary conditions
  // ---------------------------------------------------------------------------

  describe("boundary conditions", () => {
    it("should accept exactly 10 layers (at the limit)", async () => {
      const geojson = makeFeatureCollection([makePointFeature(0, 0)]);
      const tenLayers = Array.from({ length: 10 }, () => ({ type: "markers" as const }));

      const handler = createDataVizHandler();
      const response = await handler({ geojson, layers: tenLayers });

      expect(response.isError).toBeUndefined();
      const result = JSON.parse(response.content[0].text);
      expect(result.layers_applied).toHaveLength(10);
    });

    it("should accept choropleth with color_property set", async () => {
      const geojson = makeFeatureCollection([
        makePointFeature(0, 0, { region: "north", value: 42 }),
      ]);

      const handler = createDataVizHandler();
      const response = await handler({
        geojson,
        layers: [{ type: "choropleth" as const, color_property: "value" }],
      });

      expect(response.isError).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  describe("error handling", () => {
    it("should handle fetch errors from data_url gracefully", async () => {
      mockLookup.mockResolvedValue({ address: "93.184.216.34", family: 4 });
      mockAxiosGet.mockRejectedValue(new Error("Network error"));

      const handler = createDataVizHandler();
      const response = await handler({
        data_url: "https://example.com/broken.geojson",
        layers: defaultLayers,
      });

      expect(response.isError).toBe(true);
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.error).toBe("Network error");
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("should pass correct fetch config to axios including SSRF protections", async () => {
      mockLookup.mockResolvedValue({ address: "93.184.216.34", family: 4 });
      mockAxiosGet.mockResolvedValue({
        data: {
          type: "FeatureCollection",
          features: [makePointFeature(0, 0)],
        },
      });

      const handler = createDataVizHandler();
      await handler({ data_url: "https://example.com/data.geojson", layers: defaultLayers });

      expect(mockAxiosGet).toHaveBeenCalledWith(
        "https://example.com/data.geojson",
        expect.objectContaining({
          timeout: 30_000,
          maxContentLength: 50 * 1024 * 1024,
          maxBodyLength: 50 * 1024 * 1024,
          headers: { Accept: "application/geo+json, application/json" },
          responseType: "json",
          httpsAgent: expect.any(Object),
          maxRedirects: 0,
        })
      );
    });
  });
});

// ---------------------------------------------------------------------------
// SSRF protection tests (from PR #113)
// ---------------------------------------------------------------------------

function mockPublicDns(ip = "93.184.216.34") {
  mockLookup.mockResolvedValue({ address: ip, family: 4 });
}

function mockAxiosSuccess(
  data: unknown = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [4.89, 52.37] },
        properties: { name: "Amsterdam" },
      },
    ],
  }
) {
  mockAxiosGet.mockResolvedValue({ data });
}

function parseResult(result: { content: { text: string }[] }) {
  return JSON.parse(result.content[0].text);
}

describe("dataVizHandler SSRF protection", () => {
  let handler: ReturnType<typeof createDataVizHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreVizData.mockResolvedValue("test-viz-id");
    handler = createDataVizHandler();
  });

  describe("scheme validation", () => {
    it("should reject http URLs", async () => {
      const result = await handler({
        layers: [{ type: "markers" as const }],
        data_url: "http://example.com/data.geojson",
      });
      expect(result.isError).toBe(true);
      expect(parseResult(result).error).toContain("Only https URLs are allowed");
    });

    it("should reject ftp URLs", async () => {
      const result = await handler({
        layers: [{ type: "markers" as const }],
        data_url: "ftp://example.com/data.geojson",
      });
      expect(result.isError).toBe(true);
      expect(parseResult(result).error).toContain("Only https URLs are allowed");
    });

    it("should reject invalid URL format", async () => {
      const result = await handler({
        layers: [{ type: "markers" as const }],
        data_url: "not-a-url",
      });
      expect(result.isError).toBe(true);
      expect(parseResult(result).error).toContain("Invalid URL format");
    });
  });

  describe("credential validation", () => {
    it("should reject URLs with credentials", async () => {
      const result = await handler({
        layers: [{ type: "markers" as const }],
        data_url: "https://user:pass@example.com/data.geojson",
      });
      expect(result.isError).toBe(true);
      expect(parseResult(result).error).toContain("URLs with credentials are not allowed");
    });
  });

  describe("private IP blocking", () => {
    it.each([
      ["loopback", "127.0.0.1"],
      ["private 10.x", "10.0.0.1"],
      ["private 172.16.x", "172.16.0.1"],
      ["private 192.168.x", "192.168.1.1"],
      ["link-local / cloud metadata", "169.254.169.254"],
    ])("should block %s (%s)", async (_label, ip) => {
      mockLookup.mockResolvedValue({ address: ip, family: 4 });
      const result = await handler({
        layers: [{ type: "markers" as const }],
        data_url: "https://evil.com/data.geojson",
      });
      expect(result.isError).toBe(true);
      expect(parseResult(result).error).toContain("URL resolves to a non-public IP address");
    });

    it("should block IP literal in URL", async () => {
      const result = await handler({
        layers: [{ type: "markers" as const }],
        data_url: "https://127.0.0.1/data.geojson",
      });
      expect(result.isError).toBe(true);
      expect(parseResult(result).error).toContain("URL resolves to a non-public IP address");
    });
  });

  describe("IPv6 blocking", () => {
    it("should block IPv6 loopback", async () => {
      mockLookup.mockResolvedValue({ address: "::1", family: 6 });
      const result = await handler({
        layers: [{ type: "markers" as const }],
        data_url: "https://evil.com/data.geojson",
      });
      expect(result.isError).toBe(true);
      expect(parseResult(result).error).toContain("URL resolves to a non-public IP address");
    });
  });

  describe("valid public URL", () => {
    it("should allow https URL resolving to public IP", async () => {
      mockPublicDns();
      mockAxiosSuccess();
      const result = await handler({
        layers: [{ type: "markers" as const }],
        data_url: "https://example.com/data.geojson",
      });
      expect(result.isError).toBeUndefined();
      expect(parseResult(result).summary.feature_count).toBe(1);
    });
  });

  describe("DNS failure", () => {
    it("should return error when DNS resolution fails", async () => {
      mockLookup.mockRejectedValue(new Error("ENOTFOUND"));
      const result = await handler({
        layers: [{ type: "markers" as const }],
        data_url: "https://nonexistent.invalid/data.geojson",
      });
      expect(result.isError).toBe(true);
    });
  });
});
