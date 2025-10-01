/*
 * Copyright (C) 2025 TomTom NV
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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock services
vi.mock("../services/map/dynamicMapService", () => ({
  renderDynamicMap: vi.fn(),
}));

vi.mock("../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock functions
const mockRenderDynamicMap = vi.fn();
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
};

// Dynamically import after mocks are set up
let createDynamicMapHandler: any;

beforeEach(async () => {
  vi.clearAllMocks();

  // Reset mocks
  const { renderDynamicMap } = await import("../services/map/dynamicMapService");
  const { logger } = await import("../utils/logger");

  vi.mocked(renderDynamicMap).mockImplementation(mockRenderDynamicMap);
  vi.mocked(logger.info).mockImplementation(mockLogger.info);
  vi.mocked(logger.error).mockImplementation(mockLogger.error);

  // Import handler after mocks
  const { createDynamicMapHandler: handler } = await import("./dynamicMapHandler");
  createDynamicMapHandler = handler;
});

describe("createDynamicMapHandler", () => {
  it("should return image result for valid params", async () => {
    mockRenderDynamicMap.mockResolvedValue({
      base64: "fake-image-data",
      contentType: "image/png",
      width: 800,
      height: 600,
    });

    const handler = createDynamicMapHandler();
    const params = {
      markers: [{ lat: 52.374, lon: 4.8897, label: "Amsterdam" }],
    };

    const response = await handler(params);

    expect(mockRenderDynamicMap).toHaveBeenCalledWith(params);
    expect(response.content[0].type).toBe("image");
    expect(response.content[0].data).toBe("fake-image-data");
    expect(response.content[0].mimeType).toBe("image/png");
    expect(mockLogger.info).toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("should handle service errors gracefully", async () => {
    mockRenderDynamicMap.mockRejectedValue(new Error("TomTom API unavailable"));

    const handler = createDynamicMapHandler();
    const params = {
      markers: [{ lat: 52.374, lon: 4.8897 }],
    };

    const response = await handler(params);

    expect(response.isError).toBe(true);
    expect(response.content[0].type).toBe("text");
    expect(response.content[0].text).toContain("TomTom API unavailable");
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("should handle API key validation errors", async () => {
    mockRenderDynamicMap.mockRejectedValue(new Error("TomTom API key validation failed"));

    const handler = createDynamicMapHandler();
    const params = {
      markers: [{ lat: 52.374, lon: 4.8897 }],
    };

    const response = await handler(params);

    expect(response.isError).toBe(true);
    expect(response.content[0].type).toBe("text");
    expect(response.content[0].text).toContain("TomTom API key validation failed");
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("should handle invalid coordinate errors", async () => {
    mockRenderDynamicMap.mockRejectedValue(new Error("Invalid origin or destination coordinates"));

    const handler = createDynamicMapHandler();
    const params = {
      isRoute: true,
      origin: { lat: 52.374, lon: 4.8897 },
      destination: { lat: 48.8566, lon: 2.3522 },
    };

    const response = await handler(params);

    expect(response.isError).toBe(true);
    expect(response.content[0].type).toBe("text");
    expect(response.content[0].text).toContain("Invalid origin or destination coordinates");
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("should handle route planning parameters", async () => {
    mockRenderDynamicMap.mockResolvedValue({
      base64: "route-image-data",
      contentType: "image/png",
      width: 1024,
      height: 768,
    });

    const handler = createDynamicMapHandler();
    const params = {
      isRoute: true,
      origin: { lat: 52.374, lon: 4.8897 },
      destination: { lat: 48.8566, lon: 2.3522 },
      waypoints: [{ lat: 50.8503, lon: 4.3517 }],
      showLabels: true,
      use_orbis: true,
    };

    const response = await handler(params);

    expect(mockRenderDynamicMap).toHaveBeenCalledWith(params);
    expect(response.content[0].type).toBe("image");
    expect(response.content[0].data).toBe("route-image-data");
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("Dynamic map generated successfully: 1024x768")
    );
  });

  it("should log appropriate messages for different scenarios", async () => {
    mockRenderDynamicMap.mockResolvedValue({
      base64: "test-data",
      contentType: "image/png",
      width: 800,
      height: 600,
    });

    const handler = createDynamicMapHandler();
    const params = { markers: [{ lat: 0, lon: 0 }] };

    await handler(params);

    expect(mockLogger.info).toHaveBeenCalledWith("🗺️ Processing dynamic map request");
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("✅ Dynamic map generated successfully")
    );
  });
});
