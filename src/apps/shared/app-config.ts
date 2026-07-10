/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { App } from "@modelcontextprotocol/ext-apps";

/**
 * Client configuration served by the app-only tomtom-get-app-config tool
 */
export interface WidgetAppConfig {
  /** Attribution user-agent derived from the server's deployment dimension */
  userAgent?: string;
}

/**
 * Cached config value
 */
let cachedConfig: WidgetAppConfig | undefined = undefined;

/**
 * Fetches client configuration from the MCP server via tool call.
 *
 * Unlike getAPIKey this never throws: attribution is best-effort, so a
 * failure returns an empty config and callers fall back to defaults.
 *
 * @param app - Connected MCP App instance
 * @returns Promise resolving to the app config (empty object on failure)
 */
export async function getWidgetAppConfig(app: App): Promise<WidgetAppConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const result = await app.callServerTool({
      name: "tomtom-get-app-config",
      arguments: {},
    });

    const content = result.content?.[0];
    if (!result.isError && content?.type === "text" && content.text) {
      cachedConfig = JSON.parse(content.text) as WidgetAppConfig;
      return cachedConfig;
    }
  } catch {
    // fall through to empty config
  }

  // This should never happen, as dimensionless fallback values are what we are trying to avid. But it is added just in case
  console.warn("tomtom-get-app-config unavailable; using default attribution user-agent");
  cachedConfig = {};
  return cachedConfig;
}
