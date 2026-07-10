/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { App } from "@modelcontextprotocol/ext-apps";

/**
 * Client configuration served by the app-only tomtom-get-app-config tool
 */
export interface McpAppConfig {
  /** Attribution user-agent derived from the server's deployment dimension */
  userAgent: string;
}

/**
 * Cached config value
 */
let cachedConfig: McpAppConfig | undefined = undefined;

/**
 * Fetches client configuration from the MCP server via tool call
 *
 * @param app - Connected MCP App instance
 * @returns Promise resolving to the app config
 * @throws {Error} If the config cannot be fetched or is incomplete — an MCP
 * App without its server config is misconfigured, so fail early
 */
export async function getMcpAppConfig(app: App): Promise<McpAppConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const result = await app.callServerTool({
      name: "tomtom-get-app-config",
      arguments: {},
    });

    if (result.isError) {
      throw new Error("Server returned error when fetching app config");
    }

    const content = result.content?.[0];
    if (!content || content.type !== "text" || !content.text) {
      throw new Error("Invalid app config response format");
    }

    const parsed = JSON.parse(content.text) as Partial<McpAppConfig>;
    if (!parsed.userAgent) {
      throw new Error("App config is missing the userAgent value");
    }

    cachedConfig = { userAgent: parsed.userAgent };
    return cachedConfig;
  } catch (error) {
    throw new Error(
      `Failed to fetch app config: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
