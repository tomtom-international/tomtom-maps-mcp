/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { App } from "@modelcontextprotocol/ext-apps";
import { TomTomConfig } from "@tomtom-org/maps-sdk/core";
import { getAPIKey } from "./api-key";

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
  TomTomConfig.instance.put({ apiKey, language: "en-GB" });
  configInitialized = true;
}
