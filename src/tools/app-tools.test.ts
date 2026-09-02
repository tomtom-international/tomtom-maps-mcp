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
 *
 * These used to be tested through `createAppTools`, which both registered the
 * tools and closed over their handlers. Registration now lives in `register.ts`
 * (covered by `register.test.ts` for all 18 tools, not just these 3), so this
 * file tests the three handlers directly.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { VERSION } from "../version";

const mockGetEffectiveApiKey = vi.fn();
const mockGetDataset = vi.fn();

vi.mock("../services/api-key", () => ({
  getEffectiveApiKey: mockGetEffectiveApiKey,
  serverUserAgentName: "TomTomMCPSDKHttpTT-PROD",
}));

vi.mock("../services/datasets/dataset-store", () => ({
  getDataset: mockGetDataset,
}));

const { getApiKeyHandler, getAppConfigHandler, getDatasetHandler } = await import("./app-tools");

describe("getApiKeyHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return API key when available", async () => {
    mockGetEffectiveApiKey.mockReturnValue("test-api-key-123");

    const response = await getApiKeyHandler();

    expect(response.isError).toBe(false);
    expect(response.content[0].text).toBe("test-api-key-123");
  });

  it("should return error when API key is not available", async () => {
    mockGetEffectiveApiKey.mockReturnValue(undefined);

    const response = await getApiKeyHandler();

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("not available");
  });
});

describe("getAppConfigHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return the MCP App user-agent derived from the server identity", async () => {
    const response = await getAppConfigHandler();

    expect(response.isError).toBe(false);
    // Server identity mocked as TomTomMCPSDKHttpTT-PROD: same dimensions,
    // layer token swapped
    expect(JSON.parse(response.content[0].text)).toEqual({
      userAgent: `TomTomMCPAPPHttpTT-PROD/${VERSION}`,
    });
  });
});

describe("getDatasetHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("serves the dataset's payload, not its envelope", async () => {
    const fakeData = { geojson: { type: "FeatureCollection", features: [] } };
    // The store returns an envelope; the app only wants what it needs to draw.
    mockGetDataset.mockReturnValue({
      id: "ds_abc",
      data: fakeData,
      summary: { count: 0 },
      provenance: { tool: "tomtom-data-viz", params: {} },
    });

    const response = await getDatasetHandler({ dataset_id: "ds_abc" });

    expect(response.isError).toBe(false);
    expect(JSON.parse(response.content[0].text)).toEqual(fakeData);
  });

  it("should return error when the dataset is not found", async () => {
    mockGetDataset.mockReturnValue(undefined);

    const response = await getDatasetHandler({ dataset_id: "ds_expired" });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("not found");
  });
});
