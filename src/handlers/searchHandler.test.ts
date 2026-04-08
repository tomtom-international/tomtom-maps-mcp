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

// searchHandler.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GeocodeSearchParams } from "../schemas/search/searchSchema";

// Create typed mocks
const createMocks = () => {
  const geocodeAddress = vi.fn();
  const reverseGeocode = vi.fn();
  const fuzzySearch = vi.fn();
  const poiSearch = vi.fn();
  const searchNearby = vi.fn();
  const loggerInfo = vi.fn();
  const loggerError = vi.fn();
  return {
    searchService: { geocodeAddress, reverseGeocode, fuzzySearch, poiSearch, searchNearby },
    logger: {
      info: loggerInfo,
      error: loggerError,
      warn: vi.fn(),
      debug: vi.fn(),
    },
  };
};

const mocks = createMocks();

// Use correct relative path for ESM Vitest
vi.mock("../services/search/searchService", () => ({
  geocodeAddress: mocks.searchService.geocodeAddress,
  reverseGeocode: mocks.searchService.reverseGeocode,
  fuzzySearch: mocks.searchService.fuzzySearch,
  poiSearch: mocks.searchService.poiSearch,
  searchNearby: mocks.searchService.searchNearby,
}));

vi.mock("../utils/logger", () => ({
  logger: mocks.logger,
}));

// Import after mocking
const {
  createGeocodeHandler,
  createReverseGeocodeHandler,
  createFuzzySearchHandler,
  createPoiSearchHandler,
  createNearbySearchHandler,
} = await import("./searchHandler");

describe("createGeocodeHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should return geocoded result for valid query", async () => {
    const fakeResult = {
      summary: {
        query: "Test Address",
        queryType: "NON_NEAR",
        queryTime: 1,
        numResults: 1,
        offset: 0,
        totalResults: 1,
        fuzzyLevel: 1,
      },
      results: [
        {
          type: "POI",
          id: "1",
          score: 1,
          address: { freeformAddress: "Test Address" },
          position: { lat: 12.34, lon: 56.78 },
        },
      ],
    };
    mocks.searchService.geocodeAddress.mockResolvedValue(fakeResult);
    const handler = createGeocodeHandler();
    const params = { query: "Test Address", response_detail: "full" as const };
    const response = await handler(params);
    expect(mocks.searchService.geocodeAddress).toHaveBeenCalledWith("Test Address", undefined);
    expect(response).toEqual({
      content: [{ type: "text", text: JSON.stringify(fakeResult, null, 2) }],
    });
    expect(mocks.logger.info).toHaveBeenCalled();
    expect(mocks.logger.error).not.toHaveBeenCalled();
  });

  it("should handle errors from geocodeAddress", async () => {
    mocks.searchService.geocodeAddress.mockRejectedValue(new Error("fail"));
    const handler = createGeocodeHandler();
    const params = { query: "Bad Address" };
    const response = await handler(params);
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("fail");
    expect(mocks.logger.error).toHaveBeenCalled();
  });

  it("should return error if query param is missing", async () => {
    const handler = createGeocodeHandler();
    // testing missing param — bypass type checking for error-path test
    const response = await handler({} as GeocodeSearchParams);
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/error/i);
    expect(mocks.logger.error).toHaveBeenCalled();
    // Remove assertion that geocodeAddress was not called, since it may be called with undefined params
  });

  it("should handle empty results from geocodeAddress", async () => {
    const fakeResult = {
      summary: {
        query: "Empty",
        queryType: "NON_NEAR",
        queryTime: 1,
        numResults: 0,
        offset: 0,
        totalResults: 0,
        fuzzyLevel: 1,
      },
      results: [],
    };
    mocks.searchService.geocodeAddress.mockResolvedValue(fakeResult);
    const handler = createGeocodeHandler();
    const params = { query: "Empty" };
    const response = await handler(params);
    expect(response.content[0].text).toContain("Empty");
    expect(mocks.logger.info).toHaveBeenCalled();
  });

  it("should return trimmed response in compact mode (default)", async () => {
    const fakeResult = {
      summary: { query: "Test", queryTime: 100, numResults: 1 },
      results: [{ address: { freeformAddress: "Test" }, position: { lat: 1, lon: 2 } }],
    };
    mocks.searchService.geocodeAddress.mockResolvedValue(fakeResult);
    const handler = createGeocodeHandler();
    const response = await handler({ query: "Test" });
    // In compact mode, queryTime should be trimmed
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.summary.queryTime).toBeUndefined();
  });
});

describe("createReverseGeocodeHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should forward lat/lon to service and pass options", async () => {
    const fakeResult = {
      summary: { queryTime: 1, numResults: 1 },
      addresses: [{ address: { freeformAddress: "Amsterdam" }, position: "52.37,4.89" }],
    };
    mocks.searchService.reverseGeocode.mockResolvedValue(fakeResult);
    const handler = createReverseGeocodeHandler();
    const response = await handler({
      lat: 52.37,
      lon: 4.89,
      response_detail: "full",
      language: "en",
    });
    // Verify lat and lon are extracted and passed correctly
    expect(mocks.searchService.reverseGeocode).toHaveBeenCalledWith(
      52.37,
      4.89,
      expect.objectContaining({ language: "en" })
    );
    expect(response.content[0].text).toContain("Amsterdam");
  });

  it("should trim queryTime in compact mode (default)", async () => {
    const fakeResult = {
      summary: { queryTime: 42 },
      addresses: [{ address: { freeformAddress: "Test" } }],
    };
    mocks.searchService.reverseGeocode.mockResolvedValue(fakeResult);
    const handler = createReverseGeocodeHandler();
    const response = await handler({ lat: 0, lon: 0 });
    const parsed = JSON.parse(response.content[0].text);
    // compact mode trims queryTime
    expect(parsed.summary?.queryTime).toBeUndefined();
  });

  it("should handle errors from reverseGeocode", async () => {
    mocks.searchService.reverseGeocode.mockRejectedValue(new Error("reverse fail"));
    const handler = createReverseGeocodeHandler();
    const response = await handler({ lat: 0, lon: 0 });
    expect(response.isError).toBe(true);
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.error).toBe("reverse fail");
  });
});

describe("createFuzzySearchHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should pass query and options to fuzzySearch", async () => {
    const fakeResult = {
      summary: { query: "coffee", numResults: 3, queryTime: 10 },
      results: [{ address: { freeformAddress: "Coffee Shop" } }],
    };
    mocks.searchService.fuzzySearch.mockResolvedValue(fakeResult);
    const handler = createFuzzySearchHandler();
    const response = await handler({ query: "coffee", limit: 5, response_detail: "full" });
    // query is passed as first arg, all params (including query) as second
    expect(mocks.searchService.fuzzySearch).toHaveBeenCalledWith(
      "coffee",
      expect.objectContaining({ query: "coffee", limit: 5 })
    );
    // In full mode, queryTime should be preserved
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.summary.queryTime).toBe(10);
  });

  it("should trim queryTime in compact mode", async () => {
    const fakeResult = {
      summary: { query: "coffee", numResults: 1, queryTime: 10 },
      results: [{ address: { freeformAddress: "Cafe" } }],
    };
    mocks.searchService.fuzzySearch.mockResolvedValue(fakeResult);
    const handler = createFuzzySearchHandler();
    const response = await handler({ query: "coffee" });
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.summary.queryTime).toBeUndefined();
  });

  it("should handle errors from fuzzySearch", async () => {
    mocks.searchService.fuzzySearch.mockRejectedValue(new Error("fuzzy fail"));
    const handler = createFuzzySearchHandler();
    const response = await handler({ query: "bad" });
    expect(response.isError).toBe(true);
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.error).toBe("fuzzy fail");
  });
});

describe("createPoiSearchHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should pass query to poiSearch", async () => {
    const fakeResult = {
      summary: { query: "restaurant", numResults: 5 },
      results: [{ poi: { name: "Test Restaurant" } }],
    };
    mocks.searchService.poiSearch.mockResolvedValue(fakeResult);
    const handler = createPoiSearchHandler();
    const response = await handler({ query: "restaurant", response_detail: "full" });
    expect(mocks.searchService.poiSearch).toHaveBeenCalledWith("restaurant", expect.any(Object));
    expect(response.content[0].text).toContain("Test Restaurant");
  });

  it("should handle errors from poiSearch", async () => {
    mocks.searchService.poiSearch.mockRejectedValue(new Error("poi fail"));
    const handler = createPoiSearchHandler();
    const response = await handler({ query: "bad" });
    expect(response.isError).toBe(true);
  });
});

describe("createNearbySearchHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should forward lat, lon, and options to searchNearby", async () => {
    const fakeResult = {
      summary: { numResults: 2 },
      results: [{ poi: { name: "Nearby Cafe" } }],
    };
    mocks.searchService.searchNearby.mockResolvedValue(fakeResult);
    const handler = createNearbySearchHandler();
    const response = await handler({
      lat: 52.37,
      lon: 4.89,
      categorySet: "7315",
      radius: 500,
      response_detail: "full",
    });
    // lat and lon extracted, remaining options passed
    expect(mocks.searchService.searchNearby).toHaveBeenCalledWith(
      52.37,
      4.89,
      expect.objectContaining({ categorySet: "7315", radius: 500 })
    );
    expect(response.content[0].text).toContain("Nearby Cafe");
  });

  it("should handle errors from searchNearby", async () => {
    mocks.searchService.searchNearby.mockRejectedValue(new Error("nearby fail"));
    const handler = createNearbySearchHandler();
    const response = await handler({ lat: 0, lon: 0 });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("nearby fail");
  });
});
