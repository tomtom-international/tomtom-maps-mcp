/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { App } from "@modelcontextprotocol/ext-apps";
import { TomTomConfig } from "@tomtom-org/maps-sdk/core";
import { getAPIKey } from "./api-key";
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

  const apiKey = await getAPIKey(app);

  // We tag the browser-side widget traffic so we can attribute it to the MCP and not the SDK. 
  // This runs in the bundle for the host's webview through a TomTomConfig Singleton. 
  // It is different to the server traffic so it remains separable
  TomTomConfig.instance.put({
    apiKey,
    language: "en-GB",
    "tomtom-user-agent": `TomTomMCPUI/${VERSION}`,
  } as unknown as Parameters<
  typeof TomTomConfig.instance.put>[0]);
  configInitialized = true;
}
