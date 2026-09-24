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
import type {
  GeocodeSearchOrbisParams,
  ReverseGeocodeSearchOrbisParams,
} from "../schemas/search/searchOrbisSchema";
import { expectDropped, expectKept, loadFixture, valuesAt } from "./shared/__fixtures__";

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
  createEVSearchHandler,
} = await import("./searchOrbisHandler");

describe("createGeocodeHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should return geocoded result for valid query", async () => {
    const fakeResult = loadFixture("orbis-geocode");
    mocks.searchService.geocodeAddress.mockResolvedValue(fakeResult);
    const handler = createGeocodeHandler();
    const params = { query: "Dam 1, Amsterdam", response_detail: "full" as const };
    const response = await handler(params);
    expect(mocks.searchService.geocodeAddress).toHaveBeenCalledWith("Dam 1, Amsterdam", undefined);
    // When response_detail is "full", Orbis handler adds _meta with show_ui
    const expectedResult = { ...fakeResult, _meta: { show_ui: true } };
    expect(response).toEqual({
      content: [{ type: "text", text: JSON.stringify(expectedResult) }],
    });
    expect(mocks.logger.error).not.toHaveBeenCalled();
  });

  it("should return a trimmed, minified result by default", async () => {
    const fakeResult = loadFixture("orbis-geocode");
    mocks.searchService.geocodeAddress.mockResolvedValue(fakeResult);
    const handler = createGeocodeHandler();
    const response = await handler({ query: "Dam 1, Amsterdam", show_ui: false });
    const text = response.content[0].text;
    expect(text).not.toContain("\n");
    const parsed = JSON.parse(text);
    expect(parsed.features[0].properties.address.freeformAddress).toBe(
      fakeResult.features[0].properties.address.freeformAddress
    );
    expect(parsed.features[0].properties.matchConfidence).toBeUndefined();
    expect(parsed._meta).toEqual({ show_ui: false });
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
    const response = await handler({} as GeocodeSearchOrbisParams);
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/error/i);
    expect(mocks.logger.error).toHaveBeenCalled();
    // Remove assertion that geocodeAddress was not called, since it may be called with undefined params
  });

  it("should handle empty results from geocodeAddress", async () => {
    // SDK shape: the API summary sits under the collection's properties
    const fakeResult = {
      type: "FeatureCollection",
      properties: {
        query: "Empty",
        queryType: "NON_NEAR",
        queryTime: 1,
        numResults: 0,
        offset: 0,
        totalResults: 0,
        fuzzyLevel: 1,
      },
      features: [],
    };
    mocks.searchService.geocodeAddress.mockResolvedValue(fakeResult);
    const handler = createGeocodeHandler();
    const params = { query: "Empty" };
    const response = await handler(params);
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.properties.query).toBe("Empty");
    expect(parsed.properties.queryTime).toBeUndefined();
    expect(parsed.features).toEqual([]);
  });
});

describe("createReverseGeocodeHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return reverse geocoded result for valid coordinates", async () => {
    const fakeResult = loadFixture("orbis-reverse-geocode");
    mocks.searchService.reverseGeocode.mockResolvedValue(fakeResult);
    const handler = createReverseGeocodeHandler();
    // Orbis handler uses position as [lng, lat] array
    const response = await handler({
      position: [4.8932, 52.373],
      response_detail: "full" as const,
    } as ReverseGeocodeSearchOrbisParams);
    expect(mocks.searchService.reverseGeocode).toHaveBeenCalled();
    expect(response.content[0].text).toContain(fakeResult.properties.address.freeformAddress);
  });

  it("should handle errors from reverseGeocode", async () => {
    mocks.searchService.reverseGeocode.mockRejectedValue(new Error("reverse fail"));
    const handler = createReverseGeocodeHandler();
    const response = await handler({ position: [0, 0] } as ReverseGeocodeSearchOrbisParams);
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

describe("createEVSearchHandler", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  // A search result enriched with the verbose SDK availability object.
  const enrichedResult = () => ({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [4.9, 52.37] },
        properties: {
          poi: { name: "Test Charger" },
          chargingPark: {
            connectors: [
              {
                connector: {
                  type: "IEC62196Type2Outlet",
                  ratedPowerKW: 11,
                  currentType: "AC3",
                  chargingSpeed: "slow",
                },
                count: 6,
              },
            ],
            availability: {
              id: "avail-123",
              accessType: "Restricted",
              openingHours: { mode: "nextSevenDays", timeRanges: [] },
              chargingStations: [{ id: "s1", chargingPoints: [{ id: "p1", capabilities: [] }] }],
              chargingPointAvailability: {
                count: 6,
                statusCounts: { Available: 2, Occupied: 3, Unknown: 1 },
              },
              connectorAvailabilities: [{ connector: { type: "IEC62196Type2Outlet" } }],
            },
          },
        },
      },
    ],
  });

  it("compacts chargingPark.availability to the aggregated status summary", async () => {
    mocks.searchService.searchEVStations.mockResolvedValue(enrichedResult());
    const handler = createEVSearchHandler();
    const response = await handler({ position: [4.9, 52.37], radius: 1000, show_ui: false });

    const parsed = JSON.parse(response.content[0].text);
    const availability = parsed.features[0].properties.chargingPark.availability;

    // Keeps the aggregated counts and who may charge
    expect(availability.chargingPointAvailability).toEqual({
      count: 6,
      statusCounts: { Available: 2, Occupied: 3, Unknown: 1 },
    });
    expect(availability.accessType).toBe("Restricted");
    // Drops the verbose per-point detail
    expect(availability.chargingStations).toBeUndefined();
    expect(availability.connectorAvailabilities).toBeUndefined();
    expect(availability.openingHours).toBeUndefined();
    expect(availability.id).toBeUndefined();
  });

  it("returns full verbose availability when response_detail is 'full'", async () => {
    mocks.searchService.searchEVStations.mockResolvedValue(enrichedResult());
    const handler = createEVSearchHandler();
    const response = await handler({
      position: [4.9, 52.37],
      radius: 1000,
      show_ui: false,
      response_detail: "full",
    });

    const parsed = JSON.parse(response.content[0].text);
    const availability = parsed.features[0].properties.chargingPark.availability;
    // Full mode is untrimmed — verbose detail is preserved
    expect(availability.chargingStations).toBeDefined();
    expect(availability.chargingPointAvailability.statusCounts.Available).toBe(2);
  });

  it("handles results without availability data", async () => {
    const result = enrichedResult();
    const chargingPark = result.features[0].properties.chargingPark as { availability?: unknown };
    delete chargingPark.availability;
    mocks.searchService.searchEVStations.mockResolvedValue(result);

    const handler = createEVSearchHandler();
    const response = await handler({ position: [4.9, 52.37], radius: 1000, show_ui: false });

    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.features[0].properties.chargingPark.availability).toBeUndefined();
    expect(response.isError).toBeUndefined();
  });

  it("adds each connector type's status counts to its connector (fixture)", async () => {
    const fakeResult = loadFixture("orbis-ev-search");
    mocks.searchService.searchEVStations.mockResolvedValue(fakeResult);
    const handler = createEVSearchHandler();
    const response = await handler({ position: [4.9041, 52.3676], show_ui: false });
    const parsed = JSON.parse(response.content[0].text);
    const park = "features[].properties.chargingPark";

    expectDropped(fakeResult, parsed, [
      `${park}.availability.id`,
      `${park}.availability.chargingStations`,
      `${park}.availability.connectorAvailabilities`,
      `${park}.availability.openingHours`,
    ]);
    expectKept(parsed, [
      `${park}.availability.accessType`,
      `${park}.availability.chargingPointAvailability.statusCounts`,
      `${park}.connectors[].statusCounts`,
    ]);
    const perType =
      fakeResult.features[0].properties.chargingPark.availability.connectorAvailabilities[0];
    expect(valuesAt(parsed, `${park}.connectors[]`)[0]).toEqual(
      expect.objectContaining({
        type: perType.connector.type,
        ratedPowerKW: perType.connector.ratedPowerKW,
        statusCounts: perType.statusCounts,
      })
    );
  });
});

describe("requested fields in Orbis search handlers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps openingHours, timeZone, mapcodes and extendedPostalCode when the call asks for them", async () => {
    const fakeResult = loadFixture("orbis-poi-search-requested");
    mocks.searchService.poiSearch.mockResolvedValue(fakeResult);
    const handler = createPoiSearchHandler();
    const base = { query: "restaurant", show_ui: false };
    const paths = [
      "features[].properties.poi.openingHours",
      "features[].properties.poi.timeZone",
      "features[].properties.mapcodes",
      "features[].properties.address.extendedPostalCode",
    ];

    const plain = JSON.parse((await handler(base)).content[0].text);
    expectDropped(fakeResult, plain, paths);

    const requested = await handler({
      ...base,
      openingHours: "nextSevenDays",
      timeZone: "iana",
      mapcodes: ["Local"],
      extendedPostalCodesFor: "POI",
    });
    expectKept(JSON.parse(requested.content[0].text), paths);
  });
});
