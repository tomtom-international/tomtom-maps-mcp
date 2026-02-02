/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { App } from '@modelcontextprotocol/ext-apps';

/**
 * Cached API key value
 */
let cachedApiKey: string | undefined = undefined;

/**
 * Fetches the TomTom API key from the MCP server via tool call
 *
 * @param app - Connected MCP App instance
 * @returns Promise resolving to the API key
 * @throws {Error} If API key cannot be fetched
 */
export async function getAPIKey(app: App): Promise<string> {
  // Return cached value if already fetched
  if (cachedApiKey) {
    return cachedApiKey;
  }

  try {
    // Call the server-side tool to get API key
    const result = await app.callServerTool({
      name: "tomtom-get-api-key",
      arguments: {}
    });

    if (result.isError) {
      throw new Error('Server returned error when fetching API key');
    }

    if (!result.content || result.content.length === 0) {
      throw new Error('No API key returned from server');
    }

    const content = result.content[0];
    if (content.type !== 'text' || !content.text) {
      throw new Error('Invalid API key response format');
    }

    cachedApiKey = content.text;
    return cachedApiKey;
  } catch (error) {
    throw new Error(
      `Failed to fetch API key: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
