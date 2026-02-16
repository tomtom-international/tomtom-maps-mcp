/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { App } from "@modelcontextprotocol/ext-apps";

/**
 * Fetch full visualization data from server cache using viz_id
 *
 * @param app - Connected MCP App instance
 * @param vizId - Unique visualization ID from the tool response _meta
 * @returns Promise resolving to the full cached data
 * @throws {Error} If data cannot be fetched
 */
async function fetchVizData(app: App, vizId: string): Promise<any> {
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
 *
 * @param app - Connected MCP App instance
 * @param agentResponse - The tool response containing _meta.viz_id
 * @returns Promise resolving to the full data for visualization
 */
export async function extractFullData(app: App, agentResponse: any): Promise<any> {
  // New approach: fetch from cache using viz_id
  if (agentResponse._meta?.viz_id) {
    try {
      return await fetchVizData(app, agentResponse._meta.viz_id);
    } catch (e) {
      console.error("Failed to fetch viz data from cache:", e);
    }
  }

  // Fallback for backward compatibility with old compressed format
  if (agentResponse._meta?._compressed) {
    console.warn("Using deprecated _compressed format - server should be updated");
    // Note: pako decompression removed, old responses will use trimmed data
  }

  // Final fallback: use the response as-is (trimmed data)
  return agentResponse._meta?._fullData || agentResponse;
}
