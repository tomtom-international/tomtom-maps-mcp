/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { App } from "@modelcontextprotocol/ext-apps";
import { TomTomConfig } from "@tomtom-org/maps-sdk/core";
import { getAPIKey } from "./api-key";
import { useInlinedMaplibreWorker } from "./maplibre-worker";
import { SDK_USER_AGENT_CONFIG_KEY } from "../../utils/userAgent";

/**
 * Track whether TomTom config has been initialized
 */
let configInitialized = false;

/**
 * Fetches the attribution user-agent the server derived from its own identity
 * (SDK layer swapped for APP, deployment dimensions kept).
 *
 * @throws {Error} If the config cannot be fetched or is incomplete — an MCP
 * App without its server config is misconfigured, so fail early instead of
 * emitting dimensionless analytics
 */
async function fetchMcpAppUserAgent(app: App): Promise<string> {
  const result = await app.callServerTool({
    name: "tomtom-get-app-config",
    arguments: {},
  });

  const content = result.content?.[0];
  if (result.isError || content?.type !== "text" || !content.text) {
    throw new Error("Server returned an invalid app config response");
  }

  const { userAgent } = JSON.parse(content.text) as { userAgent?: string };
  if (!userAgent) {
    throw new Error("App config is missing the userAgent value");
  }
  return userAgent;
}

/**
 * Prepares the SDK for map creation: MapLibre's inlined worker and the TomTom
 * config, fetching the API key if necessary.
 *
 * @param app - Connected MCP App instance
 */
export async function ensureTomTomConfigured(app: App): Promise<void> {
  if (configInitialized) {
    return;
  }

  useInlinedMaplibreWorker();

  const [apiKey, userAgent] = await Promise.all([getAPIKey(app), fetchMcpAppUserAgent(app)]);

  // Tag the browser-side MCP App traffic so it is attributed to the MCP APP
  // layer and not the SDK default "MapsSDKJS/<ver>". The config runs in the
  // host webview's bundle through the TomTomConfig singleton.
  TomTomConfig.instance.put({
    apiKey,
    language: "en-GB",
    [SDK_USER_AGENT_CONFIG_KEY]: userAgent,
  } as unknown as Parameters<typeof TomTomConfig.instance.put>[0]);
  configInitialized = true;
}
