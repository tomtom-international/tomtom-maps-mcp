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
import type { ReverseGeocodeSearchParams } from "../../schemas/search/searchSchema";

const mocks = vi.hoisted(() => ({
  searchService: { reverseGeocode: vi.fn(), fetchPOICategories: vi.fn() },
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../services/search/searchService", () => mocks.searchService);
vi.mock("../../utils/logger", () => ({ logger: mocks.logger }));

// Import after mocking
const { reverseGeocodeHandler, poiCategoriesHandler } = await import("./search");

describe("reverseGeocodeHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return reverse geocoded result for valid coordinates", async () => {
    const fakeResult = {
      summary: { queryTime: 1, numResults: 1 },
      addresses: [{ address: { freeformAddress: "Dam Square" }, position: "52.37,4.89" }],
    };
    mocks.searchService.reverseGeocode.mockResolvedValue(fakeResult);
    // The handler uses position as [lng, lat] array
    const response = await reverseGeocodeHandler({
      position: [4.89, 52.37] as const,
      // `ReverseGeocodeSearchParams` is the post-defaults (z.infer) type, so
      // show_ui reads as required even though the schema defaults it.
    } as unknown as ReverseGeocodeSearchParams);
    expect(mocks.searchService.reverseGeocode).toHaveBeenCalled();
    expect(response.content[0].text).toContain("Dam Square");
  });

  it("should handle errors from reverseGeocode", async () => {
    mocks.searchService.reverseGeocode.mockRejectedValue(new Error("reverse fail"));
    const response = await reverseGeocodeHandler({
      position: [0, 0],
    } as ReverseGeocodeSearchParams);
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("reverse fail");
  });
});

describe("poiCategoriesHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return POI categories", async () => {
    const fakeCategories = [
      { id: "RESTAURANT", name: "Restaurant" },
      { id: "CAFE", name: "Cafe" },
    ];
    mocks.searchService.fetchPOICategories.mockResolvedValue(fakeCategories);
    const response = await poiCategoriesHandler({ filters: ["restaurant"] });
    expect(response.content[0].text).toContain("RESTAURANT");
  });

  it("should handle errors from fetchPOICategories", async () => {
    mocks.searchService.fetchPOICategories.mockRejectedValue(new Error("categories fail"));
    const response = await poiCategoriesHandler({ filters: ["test"] });
    expect(response.isError).toBe(true);
  });
});
