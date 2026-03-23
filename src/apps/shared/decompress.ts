/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { App } from "@modelcontextprotocol/ext-apps";

const VIZ_CACHE_PREFIX = "tomtom-viz-";
const VIZ_CACHE_MAX_ENTRIES = 20;

/**
 * Save visualization data to localStorage for offline/reconnect scenarios.
 * Silently fails if localStorage is unavailable or full.
 */
function saveToLocalCache(vizId: string, data: unknown): void {
  try {
    const key = VIZ_CACHE_PREFIX + vizId;
    localStorage.setItem(key, JSON.stringify(data));

    // Evict oldest entries if we exceed the limit
    const allKeys = Object.keys(localStorage).filter((k) => k.startsWith(VIZ_CACHE_PREFIX));
    if (allKeys.length > VIZ_CACHE_MAX_ENTRIES) {
      allKeys.sort();
      const toRemove = allKeys.slice(0, allKeys.length - VIZ_CACHE_MAX_ENTRIES);
      for (const k of toRemove) {
        localStorage.removeItem(k);
      }
    }
  } catch {
    // localStorage unavailable or quota exceeded — silently continue
  }
}

/**
 * Load visualization data from localStorage.
 * Returns null if not found or localStorage is unavailable.
 */
function loadFromLocalCache(vizId: string): unknown {
  try {
    const raw = localStorage.getItem(VIZ_CACHE_PREFIX + vizId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Fetch full visualization data from server cache using viz_id
 *
 * @param app - Connected MCP App instance
 * @param vizId - Unique visualization ID from the tool response _meta
 * @returns Promise resolving to the full cached data
 * @throws {Error} If data cannot be fetched
 */
async function fetchVizData(app: App, vizId: string): Promise<unknown> {
  const result = await app.callServerTool({
    name: "tomtom-get-viz-data",
    arguments: { viz_id: vizId },
  });

  if (result.isError) {
    throw new Error("Failed to fetch visualization data from cache");
  }

  if (!result.content || result.content.length === 0) {
    throw new Error("No visualization data returned from server");
  }

  const content = result.content[0];
  if (content.type !== "text" || !content.text) {
    throw new Error("Invalid visualization data response format");
  }

  return JSON.parse(content.text);
}

/**
 * Extract full data from MCP tool response by fetching from server cache.
 * The response contains a viz_id in _meta which is used to retrieve cached data.
 * Falls back to client-side localStorage when server cache is unavailable
 * (e.g. conversation reopened after server restart).
 *
 * @param app - Connected MCP App instance
 * @param agentResponse - The tool response containing _meta.viz_id
 * @returns Promise resolving to the full data for visualization
 */
export async function extractFullData<T = unknown>(app: App, agentResponse: unknown): Promise<T> {
  const response = agentResponse as Record<string, unknown> & { _meta?: Record<string, unknown> };
  const vizId = response._meta?.viz_id;

  // Primary: fetch from server cache using viz_id
  if (vizId) {
    try {
      const data = await fetchVizData(app, vizId as string);
      saveToLocalCache(vizId as string, data);
      return data as T;
    } catch (e) {
      console.error("Failed to fetch viz data from server cache:", e);

      // Fallback: try client-side localStorage
      const cached = loadFromLocalCache(vizId as string);
      if (cached) {
        console.log("Loaded viz data from client-side cache for viz_id:", vizId);
        return cached as T;
      }
    }
  }

  // Fallback for backward compatibility with old compressed format
  if (response._meta?._compressed) {
    console.warn("Using deprecated _compressed format - server should be updated");
    // Note: pako decompression removed, old responses will use trimmed data
  }

  // Final fallback: use the response as-is (trimmed data)
  return (response._meta?._fullData || response) as T;
}
