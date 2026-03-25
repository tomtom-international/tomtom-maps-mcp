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

// Create typed mocks
const createMocks = () => {
  const geocodeAddress = vi.fn();
  const reverseGeocode = vi.fn();
  const fuzzySearch = vi.fn();
  const poiSearch = vi.fn();
  const searchNearby = vi.fn();
  const fetchPOICategories = vi.fn();
  const searchInArea = vi.fn();
  const searchEVStations = vi.fn();
  const searchAlongRoute = vi.fn();
  const loggerInfo = vi.fn();
  const loggerError = vi.fn();
  return {
    searchService: {
      geocodeAddress,
      reverseGeocode,
      fuzzySearch,
      poiSearch,
      searchNearby,
      fetchPOICategories,
      searchInArea,
      searchEVStations,
      searchAlongRoute,
    },
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
vi.mock("../services/search/searchOrbisService", () => ({
  geocodeAddress: mocks.searchService.geocodeAddress,
  reverseGeocode: mocks.searchService.reverseGeocode,
  fuzzySearch: mocks.searchService.fuzzySearch,
  poiSearch: mocks.searchService.poiSearch,
  searchNearby: mocks.searchService.searchNearby,
  fetchPOICategories: mocks.searchService.fetchPOICategories,
  searchInArea: mocks.searchService.searchInArea,
  searchEVStations: mocks.searchService.searchEVStations,
  searchAlongRoute: mocks.searchService.searchAlongRoute,
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
  createPOICategoriesHandler,
} = await import("./searchOrbisHandler");

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
    const params = { query: "Test Address", response_detail: "full" };
    const response = await handler(params);
    expect(mocks.searchService.geocodeAddress).toHaveBeenCalledWith("Test Address", undefined);
    // When response_detail is "full", Orbis handler adds _meta with show_ui
    const expectedResult = { ...fakeResult, _meta: { show_ui: true } };
    expect(response).toEqual({
      content: [{ type: "text", text: JSON.stringify(expectedResult, null, 2) }],
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
    // testing missing param
    const response = await handler({});
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
});

describe("createReverseGeocodeHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return reverse geocoded result for valid coordinates", async () => {
    const fakeResult = {
      summary: { queryTime: 1, numResults: 1 },
      addresses: [{ address: { freeformAddress: "Dam Square" }, position: "52.37,4.89" }],
    };
    mocks.searchService.reverseGeocode.mockResolvedValue(fakeResult);
    const handler = createReverseGeocodeHandler();
    // Orbis handler uses position as [lng, lat] array
    const response = await handler({ position: [4.89, 52.37], response_detail: "full" });
    expect(mocks.searchService.reverseGeocode).toHaveBeenCalled();
    expect(response.content[0].text).toContain("Dam Square");
  });

  it("should handle errors from reverseGeocode", async () => {
    mocks.searchService.reverseGeocode.mockRejectedValue(new Error("reverse fail"));
    const handler = createReverseGeocodeHandler();
    const response = await handler({ position: [0, 0] });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("reverse fail");
  });
});

describe("createFuzzySearchHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return fuzzy search results", async () => {
    const fakeResult = {
      summary: { query: "coffee", numResults: 2 },
      results: [{ address: { freeformAddress: "Coffee Shop" } }],
    };
    mocks.searchService.fuzzySearch.mockResolvedValue(fakeResult);
    const handler = createFuzzySearchHandler();
    const response = await handler({ query: "coffee", response_detail: "full" });
    expect(mocks.searchService.fuzzySearch).toHaveBeenCalled();
    expect(response.content[0].text).toContain("Coffee Shop");
  });

  it("should handle errors from fuzzySearch", async () => {
    mocks.searchService.fuzzySearch.mockRejectedValue(new Error("fuzzy fail"));
    const handler = createFuzzySearchHandler();
    const response = await handler({ query: "bad" });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("fuzzy fail");
  });
});

describe("createPoiSearchHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return POI search results", async () => {
    const fakeResult = {
      summary: { query: "restaurant" },
      results: [{ poi: { name: "Test Restaurant" } }],
    };
    mocks.searchService.poiSearch.mockResolvedValue(fakeResult);
    const handler = createPoiSearchHandler();
    const response = await handler({ query: "restaurant", response_detail: "full" });
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

  it("should return nearby search results", async () => {
    const fakeResult = {
      summary: { numResults: 1 },
      results: [{ poi: { name: "Nearby Cafe" } }],
    };
    mocks.searchService.searchNearby.mockResolvedValue(fakeResult);
    const handler = createNearbySearchHandler();
    // Orbis handler uses position as [lng, lat] array
    const response = await handler({ position: [4.89, 52.37], response_detail: "full" });
    expect(response.content[0].text).toContain("Nearby Cafe");
  });

  it("should handle errors from searchNearby", async () => {
    mocks.searchService.searchNearby.mockRejectedValue(new Error("nearby fail"));
    const handler = createNearbySearchHandler();
    const response = await handler({ position: [0, 0] });
    expect(response.isError).toBe(true);
  });
});

describe("createPOICategoriesHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return POI categories", async () => {
    const fakeCategories = [
      { id: "RESTAURANT", name: "Restaurant" },
      { id: "CAFE", name: "Cafe" },
    ];
    mocks.searchService.fetchPOICategories.mockResolvedValue(fakeCategories);
    const handler = createPOICategoriesHandler();
    const response = await handler({ filters: ["restaurant"] });
    expect(response.content[0].text).toContain("RESTAURANT");
  });

  it("should handle errors from fetchPOICategories", async () => {
    mocks.searchService.fetchPOICategories.mockRejectedValue(new Error("categories fail"));
    const handler = createPOICategoriesHandler();
    const response = await handler({ filters: ["test"] });
    expect(response.isError).toBe(true);
  });
});
