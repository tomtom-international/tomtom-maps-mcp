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

// Mock services
vi.mock("../../services/map/dynamicMapService", () => ({
  renderDynamicMap: vi.fn(),
}));

vi.mock("../../services/datasets/dataset-store", () => ({
  datasetMeta: (d: { id: string }, showUi: boolean) => ({
    show_ui: showUi,
    dataset_id: d.id,
    dataset_expires_in_seconds: 600,
  }),
  storeDataset: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock functions
const mockRenderDynamicMap = vi.fn();
const mockStoreDataset = vi.fn();
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

let dynamicMapHandler: typeof import("./dynamic-map").dynamicMapHandler;

beforeEach(async () => {
  vi.clearAllMocks();

  const { renderDynamicMap } = await import("../../services/map/dynamicMapService");
  const { storeDataset } = await import("../../services/datasets/dataset-store");
  const { logger } = await import("../../utils/logger");

  vi.mocked(renderDynamicMap).mockImplementation(mockRenderDynamicMap);
  vi.mocked(storeDataset).mockImplementation(mockStoreDataset);
  vi.mocked(logger.info).mockImplementation(mockLogger.info);
  vi.mocked(logger.error).mockImplementation(mockLogger.error);
  vi.mocked(logger.warn).mockImplementation(mockLogger.warn);
  vi.mocked(logger.debug).mockImplementation(mockLogger.debug);

  mockStoreDataset.mockReturnValue({ id: "ds_123" });

  const mod = await import("./dynamic-map");
  dynamicMapHandler = mod.dynamicMapHandler;
});

const fakeRenderResult = {
  width: 800,
  height: 600,
  mapState: {
    view: { center: [4.89, 52.37], zoom: 10 },
    sources: { markers: { type: "geojson", data: {} } },
  },
};

describe("dynamicMapHandler", () => {
  it("should return exactly 2 content items: text summary and meta", async () => {
    mockRenderDynamicMap.mockResolvedValue(fakeRenderResult);

    const response = await dynamicMapHandler({
      markers: [{ lat: 52.37, lon: 4.89 }],
    });

    expect(response.content).toHaveLength(2);
    expect(response.content[0].type).toBe("text");
    expect(response.content[1].type).toBe("text");

    // No image is produced — the app draws the map
    expect(response.content.every((c) => c.type === "text")).toBe(true);

    const summary = response.content[0] as { type: "text"; text: string };
    expect(summary.text).toContain("800x600");
    expect(summary.text).toContain("markers");
  });

  it("should cache map state and include dataset_id by default", async () => {
    mockRenderDynamicMap.mockResolvedValue(fakeRenderResult);

    const response = await dynamicMapHandler({
      markers: [{ lat: 52.37, lon: 4.89 }],
    });

    // Now stores an envelope: the payload plus its kind and provenance.
    expect(mockStoreDataset).toHaveBeenCalledWith(
      expect.objectContaining({
        data: fakeRenderResult.mapState,
        kind: "mapState",
        provenance: expect.objectContaining({ tool: "tomtom-dynamic-map" }),
      })
    );
    const metaContent = response.content[1] as { type: "text"; text: string };
    const meta = JSON.parse(metaContent.text);
    expect(meta._meta.show_ui).toBe(true);
    expect(meta._meta.dataset_id).toBe("ds_123");
  });

  it("should not cache map state when show_ui is false", async () => {
    mockRenderDynamicMap.mockResolvedValue(fakeRenderResult);

    const response = await dynamicMapHandler({
      markers: [{ lat: 52.37, lon: 4.89 }],
      show_ui: false,
    });

    expect(mockStoreDataset).not.toHaveBeenCalled();
    const metaContent = response.content[1] as { type: "text"; text: string };
    const meta = JSON.parse(metaContent.text);
    expect(meta._meta.show_ui).toBe(false);
  });

  it("should summarise a map that has no sources", async () => {
    mockRenderDynamicMap.mockResolvedValue({
      width: 600,
      height: 400,
      mapState: { view: { center: [4.89, 52.37], zoom: 10 }, sources: {} },
    });

    const response = await dynamicMapHandler({ bbox: [4.8, 52.3, 5.0, 52.4] });

    const summary = response.content[0] as { type: "text"; text: string };
    expect(summary.text).toContain("600x400");
    expect(summary.text).not.toContain("layers:");
  });

  it("should return an error for failures", async () => {
    mockRenderDynamicMap.mockRejectedValue(new Error("Something went wrong"));

    const response = await dynamicMapHandler({
      markers: [{ lat: 52.37, lon: 4.89 }],
    });

    expect(response.isError).toBe(true);
    const errContent = response.content[0] as { type: "text"; text: string };
    const result = JSON.parse(errContent.text);
    expect(result.error).toBe("Something went wrong");
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
