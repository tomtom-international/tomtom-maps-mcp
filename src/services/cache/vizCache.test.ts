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

import { describe, it, expect, beforeEach } from "vitest";
import { storeVizData, getVizData, deleteVizData, getCacheStats, clearVizCache } from "./vizCache";

describe("vizCache", () => {
  beforeEach(() => {
    // Clear cache before each test
    clearVizCache();
  });

  describe("storeVizData", () => {
    it("should store data and return a UUID viz_id", async () => {
      const data = { test: "data", nested: { value: 123 } };

      const vizId = await storeVizData(data);

      expect(vizId).toBeDefined();
      expect(typeof vizId).toBe("string");
      // Should be UUID format
      expect(vizId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it("should generate unique viz_ids for each store operation", async () => {
      const data = { test: "data" };

      const vizId1 = await storeVizData(data);
      const vizId2 = await storeVizData(data);
      const vizId3 = await storeVizData(data);

      expect(vizId1).not.toBe(vizId2);
      expect(vizId2).not.toBe(vizId3);
      expect(vizId1).not.toBe(vizId3);
    });

    it("should handle complex data structures", async () => {
      const complexData = {
        routes: [
          {
            summary: { lengthInMeters: 50000, travelTimeInSeconds: 3600 },
            legs: [
              {
                points: Array.from({ length: 1000 }, (_, i) => ({
                  latitude: 52.377956 + i * 0.001,
                  longitude: 4.89707 + i * 0.001,
                })),
              },
            ],
          },
        ],
      };

      const vizId = await storeVizData(complexData);

      expect(vizId).toBeDefined();
    });
  });

  describe("getVizData", () => {
    it("should retrieve stored data by viz_id", async () => {
      const data = {
        summary: { query: "Amsterdam", queryTime: 42 },
        results: [{ id: "1", name: "Place 1" }],
      };

      const vizId = await storeVizData(data);
      const retrieved = await getVizData(vizId);

      expect(retrieved).toEqual(data);
    });

    it("should return undefined for non-existent viz_id", async () => {
      const result = await getVizData("non-existent-id");

      expect(result).toBeUndefined();
    });

    it("should return undefined for invalid UUID format", async () => {
      const result = await getVizData("invalid-format");

      expect(result).toBeUndefined();
    });

    it("should handle unicode data correctly", async () => {
      const unicodeData = {
        results: [
          { name: "Café André", address: "Straße 123, München" },
          { name: "東京タワー", address: "東京都港区" },
          { name: "Москва", address: "Красная площадь" },
        ],
      };

      const vizId = await storeVizData(unicodeData);
      const retrieved = await getVizData(vizId);

      expect(retrieved).toEqual(unicodeData);
    });
  });

  describe("deleteVizData", () => {
    it("should delete stored data and return true", async () => {
      const data = { test: "data" };
      const vizId = await storeVizData(data);

      const deleted = await deleteVizData(vizId);

      expect(deleted).toBe(true);

      const result = await getVizData(vizId);
      expect(result).toBeUndefined();
    });

    it("should return false for non-existent viz_id", async () => {
      const deleted = await deleteVizData("non-existent-id");

      expect(deleted).toBe(false);
    });
  });

  describe("getCacheStats", () => {
    it("should return cache statistics", async () => {
      const stats = getCacheStats();

      expect(stats).toBeDefined();
      expect(typeof stats.hits).toBe("number");
      expect(typeof stats.misses).toBe("number");
      expect(typeof stats.keys).toBe("number");
    });

    it("should track hits and misses", async () => {
      const data = { test: "data" };
      const vizId = await storeVizData(data);

      // This should be a hit
      await getVizData(vizId);

      // This should be a miss
      await getVizData("non-existent");

      const stats = getCacheStats();

      expect(stats.hits).toBeGreaterThan(0);
      expect(stats.misses).toBeGreaterThan(0);
    });
  });

  describe("clearVizCache", () => {
    it("should clear all cached data", async () => {
      // Store some data
      const vizId1 = await storeVizData({ data: 1 });
      const vizId2 = await storeVizData({ data: 2 });
      const vizId3 = await storeVizData({ data: 3 });

      // Verify they exist
      expect(await getVizData(vizId1)).toBeDefined();
      expect(await getVizData(vizId2)).toBeDefined();
      expect(await getVizData(vizId3)).toBeDefined();

      // Clear cache
      clearVizCache();

      // Verify they're gone
      expect(await getVizData(vizId1)).toBeUndefined();
      expect(await getVizData(vizId2)).toBeUndefined();
      expect(await getVizData(vizId3)).toBeUndefined();
    });
  });

  describe("concurrent operations", () => {
    it("should handle multiple concurrent store and get operations", async () => {
      const operations = Array.from({ length: 100 }, (_, i) => ({
        data: { index: i, timestamp: Date.now() },
      }));

      // Store all concurrently
      const vizIds = await Promise.all(operations.map((op) => storeVizData(op.data)));

      // Verify all have unique IDs
      const uniqueIds = new Set(vizIds);
      expect(uniqueIds.size).toBe(100);

      // Retrieve all concurrently
      const retrieved = await Promise.all(vizIds.map((id) => getVizData(id)));

      // Verify all were retrieved correctly
      retrieved.forEach((data, i) => {
        expect(data).toEqual(operations[i].data);
      });
    });
  });
});
