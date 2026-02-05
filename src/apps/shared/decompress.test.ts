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

import { describe, it, expect, vi } from "vitest";
import { gzipSync } from "zlib";
import { extractFullData } from "./decompress";

// Helper to compress data the same way the server does
function compressData(data: any): string {
  return gzipSync(JSON.stringify(data)).toString("base64");
}

describe("extractFullData", () => {
  it("should decompress gzip+base64 encoded data from _meta._compressed", () => {
    const fullData = {
      summary: { query: "Amsterdam", queryTime: 42, numResults: 10 },
      results: [
        { id: "1", name: "Place 1", coordinates: [4.89, 52.37] },
        { id: "2", name: "Place 2", coordinates: [4.9, 52.38] },
      ],
    };

    const agentResponse = {
      summary: { query: "Amsterdam", numResults: 10 },
      results: [{ id: "1", name: "Place 1" }],
      _meta: {
        show_ui: true,
        _compressed: compressData(fullData),
      },
    };

    const extracted = extractFullData(agentResponse);

    expect(extracted).toEqual(fullData);
    expect(extracted.summary.queryTime).toBe(42);
    expect(extracted.results).toHaveLength(2);
    expect(extracted.results[0].coordinates).toEqual([4.89, 52.37]);
  });

  it("should return agentResponse if no _meta._compressed", () => {
    const agentResponse = {
      summary: { query: "test" },
      results: [],
    };

    const extracted = extractFullData(agentResponse);

    expect(extracted).toEqual(agentResponse);
  });

  it("should return agentResponse if _meta exists but no _compressed", () => {
    const agentResponse = {
      summary: { query: "test" },
      results: [],
      _meta: {
        show_ui: false,
      },
    };

    const extracted = extractFullData(agentResponse);

    expect(extracted).toEqual(agentResponse);
  });

  it("should handle decompression errors gracefully", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const agentResponse = {
      summary: { query: "test" },
      _meta: {
        show_ui: true,
        _compressed: "invalid-not-base64-gzip-data!!!",
      },
    };

    const extracted = extractFullData(agentResponse);

    // Should return the original response on error
    expect(extracted).toEqual(agentResponse);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("should handle empty _compressed string", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const agentResponse = {
      data: "test",
      _meta: {
        _compressed: "",
      },
    };

    const extracted = extractFullData(agentResponse);

    // Empty string should fail decompression, return original
    expect(extracted).toEqual(agentResponse);

    consoleSpy.mockRestore();
  });

  it("should handle complex nested data structures", () => {
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

    const agentResponse = {
      routes: [
        {
          summary: { lengthInMeters: 50000, travelTimeInSeconds: 3600 },
          legs: [{ summary: { lengthInMeters: 50000 } }],
        },
      ],
      _meta: {
        show_ui: true,
        _compressed: compressData(fullData),
      },
    };

    const extracted = extractFullData(agentResponse);

    expect(extracted.routes[0].legs[0].points).toHaveLength(2);
    expect(extracted.routes[0].guidance.instructions).toHaveLength(2);
  });

  it("should handle unicode characters in compressed data", () => {
    const fullData = {
      results: [
        { name: "Café André", address: "Straße 123, München" },
        { name: "東京タワー", address: "東京都港区" },
        { name: "Москва", address: "Красная площадь" },
      ],
    };

    const agentResponse = {
      results: [{ name: "Café André" }],
      _meta: {
        show_ui: true,
        _compressed: compressData(fullData),
      },
    };

    const extracted = extractFullData(agentResponse);

    expect(extracted.results[0].name).toBe("Café André");
    expect(extracted.results[1].name).toBe("東京タワー");
    expect(extracted.results[2].name).toBe("Москва");
  });

  it("should handle large data compression", () => {
    // Create a large dataset
    const fullData = {
      results: Array.from({ length: 100 }, (_, i) => ({
        id: `poi-${i}`,
        name: `Place ${i}`,
        coordinates: [4.89 + i * 0.01, 52.37 + i * 0.01],
        metadata: {
          description: `This is a long description for place ${i} that contains lots of text to make the data larger`,
          tags: Array.from({ length: 10 }, (_, j) => `tag-${j}`),
        },
      })),
    };

    const agentResponse = {
      results: fullData.results.map((r) => ({ id: r.id, name: r.name })),
      _meta: {
        show_ui: true,
        _compressed: compressData(fullData),
      },
    };

    const extracted = extractFullData(agentResponse);

    expect(extracted.results).toHaveLength(100);
    expect(extracted.results[50].coordinates).toBeDefined();
    expect(extracted.results[50].metadata.tags).toHaveLength(10);
  });
});
