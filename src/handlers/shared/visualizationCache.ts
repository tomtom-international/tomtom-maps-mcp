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
 * Visualization Cache - Stores full API responses for App visualization.
 *
 * Pattern: Agent receives trimmed data (efficient), App fetches full data via separate tool.
 * This cache bridges the two by storing full responses temporarily.
 *
 * Memory safety for HTTP mode (multiple agents sharing same process):
 * - Short TTL (30 seconds) - App fetches immediately after tool result
 * - Max size limit with LRU eviction
 * - One-time retrieval: data is deleted after App fetches it
 */

interface CacheEntry {
  data: any;
  timestamp: number;
}

// In-memory cache with TTL
const cache = new Map<string, CacheEntry>();

// Cache TTL: 30 seconds (App should fetch immediately after receiving tool result)
const CACHE_TTL_MS = 30 * 1000;

// Max cache size to prevent memory issues in HTTP mode with many concurrent agents
const MAX_CACHE_SIZE = 100;

// Cleanup interval: run every 10 seconds
const CLEANUP_INTERVAL_MS = 10 * 1000;

/**
 * Generate a unique visualization ID
 */
export function generateVisualizationId(): string {
  return `viz_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Store full response data for later retrieval by App.
 * Enforces max cache size with LRU eviction.
 */
export function cacheVisualizationData(id: string, data: any): void {
  // Evict oldest entries if at capacity
  if (cache.size >= MAX_CACHE_SIZE) {
    // Find and remove oldest entry (Map maintains insertion order)
    const oldestKey = cache.keys().next().value;
    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }

  cache.set(id, {
    data,
    timestamp: Date.now(),
  });
}

/**
 * Retrieve and remove cached visualization data (one-time retrieval).
 * Returns null if not found or expired.
 */
export function getVisualizationData(id: string): any | null {
  const entry = cache.get(id);
  if (!entry) return null;

  // Always delete after retrieval (one-time use)
  cache.delete(id);

  // Check if expired
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    return null;
  }

  return entry.data;
}

/**
 * Cleanup expired entries
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [id, entry] of cache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      cache.delete(id);
    }
  }
}

// Start cleanup interval
setInterval(cleanupExpiredEntries, CLEANUP_INTERVAL_MS);

// Re-export trim functions from the dedicated trimmer file for backward compatibility
export { trimRoutingResponse, trimSearchResponse, trimTrafficResponse } from "./responseTrimmer";
