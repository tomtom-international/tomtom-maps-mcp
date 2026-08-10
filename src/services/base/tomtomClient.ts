/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { TomTomConfig } from "@tomtom-org/maps-sdk/core";
import { AsyncLocalStorage } from "async_hooks";
import axios, { type AxiosInstance } from "axios";
import dotenv from "dotenv";
import { getAppConfig } from "../../appConfig";
import { logger } from "../../utils/logger";
import {
  buildUserAgent,
  MCP_SERVER_USER_AGENT_STDIO,
  resolveHttpServerUserAgentName,
  SDK_USER_AGENT_CONFIG_KEY,
  TOMTOM_USER_AGENT_HEADER,
  type UserAgentName,
} from "../../utils/userAgent";

// Variable to track if we're running in HTTP server mode
// This will be set to true in indexHttp.ts
export let isHttpMode = false;

// Current server user-agent name (without the /<version> part). Starts as
// the stdio default and is updated by setHttpMode(). Exported as a live
// binding for consumers that derive dependent identities (see appTools.ts).
export let serverUserAgentName: UserAgentName = MCP_SERVER_USER_AGENT_STDIO;

// Load environment variables. `quiet` suppresses dotenv's load summary, which
// it would otherwise write to stdout — in stdio mode that stream carries
// JSON-RPC and any extra line corrupts the protocol.
dotenv.config({ quiet: true });

/**
 * Gets the static TomTom API key from app config.
 * Re-reads each call so .env loaded after module init is still picked up.
 */
function getStaticApiKey(): string | undefined {
  return getAppConfig().tomtomApiKey;
}

/**
 * Core Axios client for TomTom API requests
 * Uses dynamic API key resolution for both environment and session-based keys
 */
export const tomtomClient: AxiosInstance = axios.create({
  baseURL: getAppConfig().tomtomApiBaseUrl,
  paramsSerializer: { indexes: null },
});

/**
 * Applies the server identity to every outbound channel: the exported live
 * binding, the axios default header, and the maps-sdk global config (so
 * SDK service calls are attributed to the MCP and not the SDK's default
 * "MapsSDKJS/<ver>" — the config key is absent from the public GlobalConfig
 * type, hence the cast).
 */
function applyServerIdentity(name: UserAgentName): void {
  serverUserAgentName = name;
  const userAgent = buildUserAgent(name);
  tomtomClient.defaults.headers[TOMTOM_USER_AGENT_HEADER] = userAgent;
  TomTomConfig.instance.put({
    [SDK_USER_AGENT_CONFIG_KEY]: userAgent,
  } as unknown as Parameters<typeof TomTomConfig.instance.put>[0]);
}

// Default to the stdio identity — setHttpMode() overrides it in HTTP mode
applyServerIdentity(MCP_SERVER_USER_AGENT_STDIO);

// Request interceptor to add API key dynamically
tomtomClient.interceptors.request.use(
  (config) => {
    // Get API key from session context or environment
    const apiKey = getSessionApiKey() || getStaticApiKey();

    if (apiKey) {
      if (!config.params?.key) {
        config.params = { ...config.params, key: apiKey };
      }
    }

    const { key: _key, ...safeParams } = (config.params ?? {}) as Record<string, unknown>;
    logger.debug(
      {
        method: config.method?.toUpperCase(),
        baseURL: config.baseURL,
        url: config.url,
        params: safeParams,
      },
      "→ TomTom API request"
    );

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to log outcome of TomTom API calls
tomtomClient.interceptors.response.use(
  (response) => {
    logger.info(
      {
        method: response.config.method?.toUpperCase(),
        url: response.config.url,
        status: response.status,
      },
      "← TomTom API response"
    );
    return response;
  },
  (error) => {
    const config = error?.config;
    logger.info(
      {
        method: config?.method?.toUpperCase(),
        url: config?.url,
        status: error?.response?.status,
      },
      "← TomTom API error"
    );
    return Promise.reject(error);
  }
);

/**
 * Request context for session-specific configuration
 */
interface RequestContext {
  apiKey: string;
}

/**
 * AsyncLocalStorage for proper per-request context isolation
 * This ensures multiple concurrent HTTP sessions don't interfere with each other
 */
const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * Get session-specific API key from current async context
 */
export function getSessionApiKey(): string | undefined {
  const context = requestContext.getStore();
  return context?.apiKey;
}

/**
 * Set session-specific configuration for the current async context
 */
export function setSessionContext(apiKey: string): void {
  const context = requestContext.getStore();
  if (context) {
    context.apiKey = apiKey;
  }
}

/**
 * Run function within a session context (for HTTP requests)
 */
export function runWithSessionContext<T>(apiKey: string, fn: () => T): T {
  return requestContext.run({ apiKey }, fn);
}

/**
 * Get the effective API key (session or environment)
 */
export function getEffectiveApiKey(): string | undefined {
  return getSessionApiKey() || getStaticApiKey();
}

/**
 * Helper function to validate that API key exists before making calls
 * @throws {Error} If the API key is not set
 * @returns {void} Nothing if validation passes
 */
export function validateApiKey(): void {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) {
    throw new Error(
      "TomTom API key is not set. Please set TOMTOM_API_KEY environment variable or provide via session configuration."
    );
  }
}

/**
 * Set the mode to HTTP server mode and switch to the HTTP server identity.
 *
 * @param configuredUserAgentName - the configured server identity (sourced
 * from MCP_TRANSPORT_MODE); when unset the default HTTP identity applies
 * @throws {Error} If the configured name is outside the user-agent naming
 * grammar — sdk_name analytics depend on predictable values
 */
export function setHttpMode(configuredUserAgentName?: string): void {
  isHttpMode = true;
  const httpUserAgentName = resolveHttpServerUserAgentName(configuredUserAgentName);
  applyServerIdentity(httpUserAgentName);
  logger.debug(
    { user_agent: buildUserAgent(httpUserAgentName) },
    "TomTom MCP client set to HTTP mode"
  );
}

/**
 * API version constants for the TomTom Maps API
 * Each API has its own version number which can change independently
 */
export const API_VERSION = {
  SEARCH: 1,
  GEOCODING: 1,
  ROUTING: 2,
  TRAFFIC: 1,
  MAP: 1,
} as const;
