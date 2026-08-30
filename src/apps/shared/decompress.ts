/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { App } from "@modelcontextprotocol/ext-apps";

const DATASET_CACHE_PREFIX = "tomtom-dataset-";
const DATASET_CACHE_MAX_ENTRIES = 20;

/**
 * Save dataset to localStorage for offline/reconnect scenarios.
 * Silently fails if localStorage is unavailable or full.
 */
function saveToLocalCache(datasetId: string, data: unknown): void {
  try {
    const key = DATASET_CACHE_PREFIX + datasetId;
    localStorage.setItem(key, JSON.stringify(data));

    // Evict oldest entries if we exceed the limit
    const allKeys = Object.keys(localStorage).filter((k) => k.startsWith(DATASET_CACHE_PREFIX));
    if (allKeys.length > DATASET_CACHE_MAX_ENTRIES) {
      allKeys.sort();
      const toRemove = allKeys.slice(0, allKeys.length - DATASET_CACHE_MAX_ENTRIES);
      for (const k of toRemove) {
        localStorage.removeItem(k);
      }
    }
  } catch {
    // localStorage unavailable or quota exceeded — silently continue
  }
}

/**
 * Load dataset from localStorage.
 * Returns null if not found or localStorage is unavailable.
 */
function loadFromLocalCache(datasetId: string): unknown {
  try {
    const raw = localStorage.getItem(DATASET_CACHE_PREFIX + datasetId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Fetch a full dataset from the server store using its dataset_id
 *
 * @param app - Connected MCP App instance
 * @param datasetId - Unique visualization ID from the tool response _meta
 * @returns Promise resolving to the full cached data
 * @throws {Error} If data cannot be fetched
 */
async function fetchDataset(app: App, datasetId: string): Promise<unknown> {
  const result = await app.callServerTool({
    name: "tomtom-get-dataset",
    arguments: { dataset_id: datasetId },
  });

  if (result.isError) {
    throw new Error("Failed to fetch dataset from cache");
  }

  if (!result.content || result.content.length === 0) {
    throw new Error("No dataset returned from server");
  }

  const content = result.content[0];
  if (content.type !== "text" || !content.text) {
    throw new Error("Invalid dataset response format");
  }

  return JSON.parse(content.text);
}

/**
 * Extract full data from MCP tool response by fetching from server cache.
 * The response carries a dataset_id in _meta, used to retrieve the full payload.
 * Falls back to client-side localStorage when server cache is unavailable
 * (e.g. conversation reopened after server restart).
 *
 * @param app - Connected MCP App instance
 * @param agentResponse - The tool response containing _meta.dataset_id
 * @returns Promise resolving to the full data for visualization
 */
export async function extractFullData<T = unknown>(app: App, agentResponse: unknown): Promise<T> {
  const response = agentResponse as Record<string, unknown> & { _meta?: Record<string, unknown> };
  const datasetId = response._meta?.dataset_id;

  // Primary: fetch from the server store using dataset_id
  if (datasetId) {
    try {
      const data = await fetchDataset(app, datasetId as string);
      saveToLocalCache(datasetId as string, data);
      return data as T;
    } catch (e) {
      console.error("Failed to fetch the dataset from the server store:", e);

      // Fallback: try client-side localStorage
      const cached = loadFromLocalCache(datasetId as string);
      if (cached) {
        console.log("Loaded dataset from client-side cache for dataset_id:", datasetId);
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
