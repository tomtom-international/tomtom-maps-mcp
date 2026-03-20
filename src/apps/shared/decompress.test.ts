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
import { extractFullData } from "./decompress";

// Mock App type
interface MockApp {
  callServerTool: ReturnType<typeof vi.fn>;
}

describe("extractFullData", () => {
  let mockApp: MockApp;

  beforeEach(() => {
    mockApp = {
      callServerTool: vi.fn(),
    };
  });

  it("should fetch full data from cache using viz_id", async () => {
    const fullData = {
      summary: { query: "Amsterdam", queryTime: 42, numResults: 10 },
      results: [
        { id: "1", name: "Place 1", coordinates: [4.89, 52.37] },
        { id: "2", name: "Place 2", coordinates: [4.9, 52.38] },
      ],
    };

    mockApp.callServerTool.mockResolvedValue({
      isError: false,
      content: [{ type: "text", text: JSON.stringify(fullData) }],
    });

    const agentResponse = {
      summary: { query: "Amsterdam", numResults: 10 },
      results: [{ id: "1", name: "Place 1" }],
      _meta: {
        show_ui: true,
        viz_id: "test-viz-id-123",
      },
    };

    const extracted = await extractFullData(mockApp as any, agentResponse);

    expect(mockApp.callServerTool).toHaveBeenCalledWith({
      name: "tomtom-get-viz-data",
      arguments: { viz_id: "test-viz-id-123" },
    });
    expect(extracted).toEqual(fullData);
    expect(extracted.summary.queryTime).toBe(42);
    expect(extracted.results).toHaveLength(2);
  });

  it("should return agentResponse if no _meta.viz_id", async () => {
    const agentResponse = {
      summary: { query: "test" },
      results: [],
    };

    const extracted = await extractFullData(mockApp as any, agentResponse);

    expect(mockApp.callServerTool).not.toHaveBeenCalled();
    expect(extracted).toEqual(agentResponse);
  });

  it("should return agentResponse if _meta exists but no viz_id", async () => {
    const agentResponse = {
      summary: { query: "test" },
      results: [],
      _meta: {
        show_ui: false,
      },
    };

    const extracted = await extractFullData(mockApp as any, agentResponse);

    expect(mockApp.callServerTool).not.toHaveBeenCalled();
    expect(extracted).toEqual(agentResponse);
  });

  it("should handle cache fetch errors gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockApp.callServerTool.mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: "Visualization data not found or expired" }],
    });

    const agentResponse = {
      summary: { query: "test" },
      _meta: {
        show_ui: true,
        viz_id: "expired-viz-id",
      },
    };

    const extracted = await extractFullData(mockApp as any, agentResponse);

    // Should return the original response on error
    expect(extracted).toEqual(agentResponse);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("should handle empty content response gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockApp.callServerTool.mockResolvedValue({
      isError: false,
      content: [],
    });

    const agentResponse = {
      data: "test",
      _meta: {
        viz_id: "some-id",
      },
    };

    const extracted = await extractFullData(mockApp as any, agentResponse);

    // Should return the original response
    expect(extracted).toEqual(agentResponse);

    consoleSpy.mockRestore();
  });

  it("should handle complex nested data structures", async () => {
    const fullData = {
      routes: [
        {
          summary: { lengthInMeters: 50000, travelTimeInSeconds: 3600 },
          legs: [
            {
              points: [
                { latitude: 52.377956, longitude: 4.89707 },
                { latitude: 52.520008, longitude: 13.404954 },
              ],
              summary: { lengthInMeters: 50000 },
            },
          ],
          guidance: {
            instructions: [
              { message: "Head north", distance: 100 },
              { message: "Turn right", distance: 500 },
            ],
          },
        },
      ],
    };

    mockApp.callServerTool.mockResolvedValue({
      isError: false,
      content: [{ type: "text", text: JSON.stringify(fullData) }],
    });

    const agentResponse = {
      routes: [
        {
          summary: { lengthInMeters: 50000, travelTimeInSeconds: 3600 },
          legs: [{ summary: { lengthInMeters: 50000 } }],
        },
      ],
      _meta: {
        show_ui: true,
        viz_id: "route-viz-id",
      },
    };

    const extracted = await extractFullData(mockApp as any, agentResponse);

    expect(extracted.routes[0].legs[0].points).toHaveLength(2);
    expect(extracted.routes[0].guidance.instructions).toHaveLength(2);
  });

  it("should handle unicode characters in fetched data", async () => {
    const fullData = {
      results: [
        { name: "Café André", address: "Straße 123, München" },
        { name: "東京タワー", address: "東京都港区" },
        { name: "Москва", address: "Красная площадь" },
      ],
    };

    mockApp.callServerTool.mockResolvedValue({
      isError: false,
      content: [{ type: "text", text: JSON.stringify(fullData) }],
    });

    const agentResponse = {
      results: [{ name: "Café André" }],
      _meta: {
        show_ui: true,
        viz_id: "unicode-viz-id",
      },
    };

    const extracted = await extractFullData(mockApp as any, agentResponse);

    expect(extracted.results[0].name).toBe("Café André");
    expect(extracted.results[1].name).toBe("東京タワー");
    expect(extracted.results[2].name).toBe("Москва");
  });

  it("should handle large data from cache", async () => {
    // Create a large dataset
    const fullData = {
      results: Array.from({ length: 100 }, (_, i) => ({
        id: `poi-${i}`,
        name: `Place ${i}`,
        coordinates: [4.89 + i * 0.01, 52.37 + i * 0.01],
        metadata: {
          description: `This is a long description for place ${i} that contains lots of text`,
          tags: Array.from({ length: 10 }, (_, j) => `tag-${j}`),
        },
      })),
    };

    mockApp.callServerTool.mockResolvedValue({
      isError: false,
      content: [{ type: "text", text: JSON.stringify(fullData) }],
    });

    const agentResponse = {
      results: fullData.results.map((r) => ({ id: r.id, name: r.name })),
      _meta: {
        show_ui: true,
        viz_id: "large-data-viz-id",
      },
    };

    const extracted = await extractFullData(mockApp as any, agentResponse);

    expect(extracted.results).toHaveLength(100);
    expect(extracted.results[50].coordinates).toBeDefined();
    expect(extracted.results[50].metadata.tags).toHaveLength(10);
  });

  it("should fallback to _fullData for backward compatibility", async () => {
    const agentResponse = {
      summary: { query: "test" },
      _meta: {
        show_ui: true,
        _fullData: { summary: { query: "test", extra: "data" } },
      },
    };

    const extracted = await extractFullData(mockApp as any, agentResponse);

    expect(mockApp.callServerTool).not.toHaveBeenCalled();
    expect(extracted).toEqual({ summary: { query: "test", extra: "data" } });
  });

  it("should warn about deprecated _compressed format", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const agentResponse = {
      summary: { query: "test" },
      _meta: {
        show_ui: true,
        _compressed: "some-base64-data",
      },
    };

    const extracted = await extractFullData(mockApp as any, agentResponse);

    expect(consoleSpy).toHaveBeenCalledWith(
      "Using deprecated _compressed format - server should be updated"
    );
    // Should fallback to original response
    expect(extracted).toEqual(agentResponse);

    consoleSpy.mockRestore();
  });
});
