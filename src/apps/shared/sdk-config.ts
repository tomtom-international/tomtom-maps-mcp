/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { App } from "@modelcontextprotocol/ext-apps";
import { TomTomConfig } from "@tomtom-org/maps-sdk/core";
import { getAPIKey } from "./api-key";
import { getWidgetAppConfig } from "./app-config";
import { VERSION } from "../../version";

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

  const [apiKey, appConfig] = await Promise.all([getAPIKey(app), getWidgetAppConfig(app)]);

  // We tag the browser-side MCP App traffic so we can attribute it to the MCP and not the SDK.
  // This runs in the bundle for the host's webview through a TomTomConfig Singleton.
  // The server derives the value from its own user-agent so widget traffic carries the same
  // deployment dimension (TomTomMCPUI / TomTomMCPUIHttp / TomTomMCPUIHttpTT-<ENV>) while
  // remaining separable from server traffic. Fall back to the plain UI value if the config
  // tool is unavailable so attribution never regresses.
  TomTomConfig.instance.put({
    apiKey,
    language: "en-GB",
    "tomtom-user-agent": appConfig.userAgent ?? `TomTomMCPUI/${VERSION}`,
  } as unknown as Parameters<
  typeof TomTomConfig.instance.put>[0]);
  configInitialized = true;
}
