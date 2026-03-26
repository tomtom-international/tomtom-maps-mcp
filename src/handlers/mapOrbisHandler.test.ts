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

// Mock services
vi.mock("../services/map/dynamicMapService", () => ({
  renderDynamicMap: vi.fn(),
  compressMapImage: vi.fn(),
}));

vi.mock("../services/cache/vizCache", () => ({
  storeVizData: vi.fn(),
}));

vi.mock("../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock functions
const mockRenderDynamicMap = vi.fn();
const mockCompressMapImage = vi.fn();
const mockStoreVizData = vi.fn();
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

let createDynamicOrbisMapHandler: typeof import("./mapOrbisHandler").createDynamicOrbisMapHandler;

beforeEach(async () => {
  vi.clearAllMocks();

  const { renderDynamicMap, compressMapImage } = await import("../services/map/dynamicMapService");
  const { storeVizData } = await import("../services/cache/vizCache");
  const { logger } = await import("../utils/logger");

  vi.mocked(renderDynamicMap).mockImplementation(mockRenderDynamicMap);
  vi.mocked(compressMapImage).mockImplementation(mockCompressMapImage);
  vi.mocked(storeVizData).mockImplementation(mockStoreVizData);
  vi.mocked(logger.info).mockImplementation(mockLogger.info);
  vi.mocked(logger.error).mockImplementation(mockLogger.error);
  vi.mocked(logger.warn).mockImplementation(mockLogger.warn);
  vi.mocked(logger.debug).mockImplementation(mockLogger.debug);

  mockCompressMapImage.mockResolvedValue({
    base64: "compressed-data",
    contentType: "image/png",
  });
  mockStoreVizData.mockResolvedValue("viz-123");

  const mod = await import("./mapOrbisHandler");
  createDynamicOrbisMapHandler = mod.createDynamicOrbisMapHandler;
});

const fakeRenderResult = {
  base64: "fake-image-data",
  contentType: "image/png",
  width: 800,
  height: 600,
  mapState: { center: [4.89, 52.37], zoom: 10 },
};

describe("createDynamicOrbisMapHandler", () => {
  it("should return exactly 3 content items: text summary, image, meta", async () => {
    mockRenderDynamicMap.mockResolvedValue(fakeRenderResult);

    const handler = createDynamicOrbisMapHandler();
    const response = await handler({
      markers: [{ lat: 52.37, lon: 4.89 }],
    });

    // Verify response structure: [text, image, text(meta)] in exact order
    expect(response.content).toHaveLength(3);
    expect(response.content[0].type).toBe("text");
    expect(response.content[1].type).toBe("image");
    expect(response.content[2].type).toBe("text");

    // Text summary includes dimensions and size
    const summary = response.content[0] as { type: "text"; text: string };
    expect(summary.text).toContain("800x600");
    expect(summary.text).toContain("compact");

    // Image uses compressed data in compact mode
    const imgContent = response.content[1] as { type: "image"; data: string; mimeType: string };
    expect(imgContent.data).toBe("compressed-data");
    expect(imgContent.mimeType).toBe("image/png");
    expect(mockCompressMapImage).toHaveBeenCalledWith("fake-image-data");
  });

  it("should skip compression in full detail mode", async () => {
    mockRenderDynamicMap.mockResolvedValue(fakeRenderResult);

    const handler = createDynamicOrbisMapHandler();
    const response = await handler({
      markers: [{ lat: 52.37, lon: 4.89 }],
      detail: "full",
    });

    const imgContent = response.content[1] as { type: "image"; data: string; mimeType: string };
    expect(imgContent.data).toBe("fake-image-data");
    expect(imgContent.mimeType).toBe("image/png");
    expect(mockCompressMapImage).not.toHaveBeenCalled();
  });

  it("should fall back to original image when compression fails", async () => {
    mockRenderDynamicMap.mockResolvedValue(fakeRenderResult);
    mockCompressMapImage.mockRejectedValue(new Error("compression failed"));

    const handler = createDynamicOrbisMapHandler();
    const response = await handler({
      markers: [{ lat: 52.37, lon: 4.89 }],
    });

    const imgContent = response.content[1] as { type: "image"; data: string; mimeType: string };
    expect(imgContent.data).toBe("fake-image-data");
    expect(imgContent.mimeType).toBe("image/png");
    expect(mockLogger.warn).toHaveBeenCalled();
    expect(response.isError).toBeUndefined();
  });

  it("should cache map state and include viz_id when show_ui is true", async () => {
    mockRenderDynamicMap.mockResolvedValue(fakeRenderResult);

    const handler = createDynamicOrbisMapHandler();
    const response = await handler({
      markers: [{ lat: 52.37, lon: 4.89 }],
      show_ui: true,
    });

    expect(mockStoreVizData).toHaveBeenCalledWith(fakeRenderResult.mapState);
    // The last content item should contain _meta with viz_id
    const metaContent = response.content[2] as { type: "text"; text: string };
    const meta = JSON.parse(metaContent.text);
    expect(meta._meta.show_ui).toBe(true);
    expect(meta._meta.viz_id).toBe("viz-123");
  });

  it("should not cache map state when show_ui is false", async () => {
    mockRenderDynamicMap.mockResolvedValue(fakeRenderResult);

    const handler = createDynamicOrbisMapHandler();
    const response = await handler({
      markers: [{ lat: 52.37, lon: 4.89 }],
      show_ui: false,
    });

    expect(mockStoreVizData).not.toHaveBeenCalled();
    const metaContent = response.content[2] as { type: "text"; text: string };
    const meta = JSON.parse(metaContent.text);
    expect(meta._meta.show_ui).toBe(false);
  });

  it("should return specific error when dynamic map dependencies are not available", async () => {
    mockRenderDynamicMap.mockRejectedValue(
      new Error("Dynamic map dependencies not available")
    );

    const handler = createDynamicOrbisMapHandler();
    const response = await handler({
      markers: [{ lat: 52.37, lon: 4.89 }],
    });

    expect(response.isError).toBe(true);
    const errContent = response.content[0] as { type: "text"; text: string };
    const result = JSON.parse(errContent.text);
    expect(result.error).toContain("Dynamic map dependencies not available");
    expect(result.help).toContain("skia-canvas");
  });

  it("should return generic error for other failures", async () => {
    mockRenderDynamicMap.mockRejectedValue(new Error("Something went wrong"));

    const handler = createDynamicOrbisMapHandler();
    const response = await handler({
      markers: [{ lat: 52.37, lon: 4.89 }],
    });

    expect(response.isError).toBe(true);
    const errContent = response.content[0] as { type: "text"; text: string };
    const result = JSON.parse(errContent.text);
    expect(result.error).toBe("Something went wrong");
    expect(result.help).toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("should not cache when mapState is absent", async () => {
    mockRenderDynamicMap.mockResolvedValue({
      base64: "fake-image-data",
      contentType: "image/png",
      width: 800,
      height: 600,
      // no mapState
    });

    const handler = createDynamicOrbisMapHandler();
    const response = await handler({
      markers: [{ lat: 52.37, lon: 4.89 }],
      show_ui: true,
    });

    expect(mockStoreVizData).not.toHaveBeenCalled();
    const metaContent = response.content[2] as { type: "text"; text: string };
    const meta = JSON.parse(metaContent.text);
    expect(meta._meta.show_ui).toBe(false);
  });
});
