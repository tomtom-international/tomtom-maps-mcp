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
 * Visualization data cache service using node-cache.
 * Stores full API responses with short TTL for MCP Apps to retrieve.
 */

import NodeCache from "node-cache";
import { randomUUID } from "node:crypto";
import { logger } from "../../utils/logger";

/**
 * Cache configuration
 * - stdTTL: Time to live in seconds (5 minutes default)
 * - checkperiod: Automatic delete check interval (1 minute)
 * - useClones: Set to false for performance (we trust our data)
 */
const CACHE_CONFIG = {
  stdTTL: 300, // 5 minutes - short-lived cache for visualization data
  checkperiod: 60, // Check for expired keys every 60 seconds
  useClones: false, // Don't clone objects for better performance
};

/**
 * Singleton cache instance
 * This is shared across all requests in both stdio and HTTP modes
 */
const vizCache = new NodeCache(CACHE_CONFIG);

/**
 * Store visualization data in cache and return unique viz_id
 *
 * @param data - Full API response data to cache
 * @returns Promise resolving to unique viz_id
 */
export async function storeVizData(data: unknown): Promise<string> {
  const vizId = randomUUID();

  try {
    const success = vizCache.set(vizId, data);
    if (!success) {
      logger.error({ vizId }, "Failed to store visualization data in cache");
      throw new Error("Cache storage failed");
    }

    logger.debug({ vizId, ttl: CACHE_CONFIG.stdTTL }, "Stored visualization data in cache");
    return vizId;
  } catch (error) {
    logger.error(
      { vizId, error: error instanceof Error ? error.message : error },
      "Error storing viz data"
    );
    throw error;
  }
}

/**
 * Retrieve visualization data from cache by viz_id
 *
 * @param vizId - Unique visualization ID
 * @returns Promise resolving to cached data or undefined if not found/expired
 */
export async function getVizData(vizId: string): Promise<unknown | undefined> {
  try {
    const data = vizCache.get(vizId);

    if (data === undefined) {
      logger.debug({ vizId }, "Visualization data not found in cache (expired or invalid)");
      return undefined;
    }

    logger.debug({ vizId }, "Retrieved visualization data from cache");
    return data;
  } catch (error) {
    logger.error(
      { vizId, error: error instanceof Error ? error.message : error },
      "Error retrieving viz data"
    );
    return undefined;
  }
}

/**
 * Delete visualization data from cache
 * Useful for cleanup after app has consumed the data
 *
 * @param vizId - Unique visualization ID
 * @returns Promise resolving to true if deleted, false if not found
 */
export async function deleteVizData(vizId: string): Promise<boolean> {
  try {
    const deleted = vizCache.del(vizId);
    logger.debug({ vizId, deleted: deleted > 0 }, "Deleted visualization data from cache");
    return deleted > 0;
  } catch (error) {
    logger.error(
      { vizId, error: error instanceof Error ? error.message : error },
      "Error deleting viz data"
    );
    return false;
  }
}

/**
 * Get cache statistics for monitoring
 *
 * @returns Cache statistics object
 */
export function getCacheStats(): NodeCache.Stats {
  return vizCache.getStats();
}

/**
 * Clear all cached visualization data
 * Useful for testing or server shutdown
 */
export function clearVizCache(): void {
  vizCache.flushAll();
  logger.info("Cleared all visualization data from cache");
}
