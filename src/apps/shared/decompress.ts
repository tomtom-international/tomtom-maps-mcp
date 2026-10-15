/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { APP_DATA_META_KEY } from "../../constants";

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

    // Keep at most VIZ_CACHE_MAX_ENTRIES; keys are random UUIDs, so which go is arbitrary
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

/** The data the server inlined: base64 of its gzipped JSON. */
async function decodeInline(encoded: string): Promise<unknown> {
  const gzipped = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  const json = new Blob([gzipped]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(json).text());
}

/**
 * The full data an app draws from its tool result (CONTEXT.md, App data), from the
 * first of these that has it:
 * - the result's `_meta`, where the server inlines it when it fits;
 * - the server's viz cache, by the text's `viz_id`, then this browser's copy;
 * - the response itself: the full data under response_detail "full", else the trimmed data.
 */
export async function extractFullData<T = unknown>(
  app: App,
  result: Pick<CallToolResult, "_meta">,
  agentResponse: unknown
): Promise<T> {
  const inline = result._meta?.[APP_DATA_META_KEY];
  if (typeof inline === "string") {
    try {
      return (await decodeInline(inline)) as T;
    } catch (error) {
      console.error("Failed to decode the inline app data:", error);
    }
  }

  const response = agentResponse as Record<string, unknown> & { _meta?: Record<string, unknown> };
  const vizId = response._meta?.viz_id;
  if (typeof vizId === "string") {
    try {
      const data = await fetchVizData(app, vizId);
      saveToLocalCache(vizId, data);
      return data as T;
    } catch (error) {
      console.error("Failed to fetch viz data from server cache:", error);
      const cached = loadFromLocalCache(vizId);
      if (cached) return cached as T;
    }
  }
  return response as T;
}
