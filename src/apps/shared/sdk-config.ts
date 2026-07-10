/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { App } from "@modelcontextprotocol/ext-apps";
import { TomTomConfig } from "@tomtom-org/maps-sdk/core";
import { getAPIKey } from "./api-key";
import { getMcpAppConfig } from "./app-config";
import { SDK_USER_AGENT_CONFIG_KEY } from "../../utils/userAgent";

/**
 * Track whether TomTom config has been initialized
 */
let configInitialized = false;

/**
 * Ensures TomTom SDK config is initialized, fetching API key if necessary
 *
 * @param app - Connected MCP App instance
 */
export async function ensureTomTomConfigured(app: App): Promise<void> {
  if (configInitialized) {
    return;
  }

  const [apiKey, appConfig] = await Promise.all([getAPIKey(app), getMcpAppConfig(app)]);

  // We tag the browser-side MCP App traffic so we can attribute it to the MCP and not the SDK.
  // This runs in the bundle for the host's webview through a TomTomConfig Singleton.
  // The server derives the value from its own user-agent so MCP App traffic carries the same
  // deployment dimension (TomTomMCPAPP / TomTomMCPAPPHttp / TomTomMCPAPPHttpTT-<ENV>) while
  // remaining separable from server traffic. No fallback: getMcpAppConfig throws when the
  // config is unavailable, so a misconfigured app fails early instead of emitting
  // dimensionless analytics.
  TomTomConfig.instance.put({
    apiKey,
    language: "en-GB",
    [SDK_USER_AGENT_CONFIG_KEY]: appConfig.userAgent,
  } as unknown as Parameters<
  typeof TomTomConfig.instance.put>[0]);
  configInitialized = true;
}
