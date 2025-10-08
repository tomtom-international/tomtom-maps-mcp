/*
 * Copyright (C) 2025 TomTom NV
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

import axios, { AxiosInstance } from "axios";
import dotenv from "dotenv";
import { AsyncLocalStorage } from "async_hooks";
import { logger } from "../../utils/logger";
import { VERSION } from "../../version";

// Variable to track if we're running in HTTP server mode
// This will be set to true in indexHttp.ts
export let isHttpMode = false;

// Load environment variables
dotenv.config();

/**
 * TomTom API configuration constants
 */
export const CONFIG = {
  BASE_URL: "https://api.tomtom.com",
} as const;

/**
 * Gets the TomTom API key from environment variables
 * This ensures we always get the most up-to-date value
 * @returns The API key from environment variables or undefined if not set
 */
function getApiKeyFromEnv(): string | undefined {
  const apiKey = process.env.TOMTOM_API_KEY;

  if (!apiKey) {
    const errorMessage = "ERROR: TOMTOM_API_KEY environment variable is not set!";
    logger.error(errorMessage);
    logger.error("Please set your TomTom API key in the .env file or as an environment variable.");
    logger.error("You can get a key from https://developer.tomtom.com/");
    // Don't throw here - we'll check for API key before each request
  }

  return apiKey;
}

/**
 * Core Axios client for TomTom API requests
 * Uses dynamic API key resolution for both environment and session-based keys
 */
export const tomtomClient: AxiosInstance = axios.create({
  baseURL: CONFIG.BASE_URL,
  paramsSerializer: { indexes: null },
  headers: {
    // Default to standard user-agent for stdio mode - will be updated if HTTP mode is set
    "TomTom-User-Agent": `TomTomMCPSDK/${VERSION}`,
  },
});

// Request interceptor to add API key dynamically
tomtomClient.interceptors.request.use(
  (config) => {
    // Get API key from session context or environment
    const apiKey = getSessionApiKey() || getApiKeyFromEnv();

    if (apiKey) {
      // Add API key to request params
      // config.params = { ...config.params, key: apiKey };
      if (!config.params?.key) {
        config.params = { ...config.params, key: apiKey };
      }
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Request context for session-specific configuration
 */
interface RequestContext {
  apiKey: string;
  backend?: "genesis" | "orbis";
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
export function setSessionContext(apiKey: string, backend?: "genesis" | "orbis"): void {
  const context = requestContext.getStore();
  if (context) {
    context.apiKey = apiKey;
    context.backend = backend;
  }
}

/**
 * Run function within a session context (for HTTP requests)
 */
export function runWithSessionContext<T>(
  apiKey: string,
  backend: "genesis" | "orbis",
  fn: () => T
): T {
  return requestContext.run({ apiKey, backend }, fn);
}

/**
 * Get current session backend
 */
export function getSessionBackend(): "genesis" | "orbis" | undefined {
  const context = requestContext.getStore();
  return context?.backend;
}

/**
 * Get the effective API key (session or environment)
 */
export function getEffectiveApiKey(): string | undefined {
  return getSessionApiKey() || getApiKeyFromEnv();
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
 * Set the mode to HTTP server mode
 * This changes the user-agent header to indicate HTTP mode
 * Uses MCP_TRANSPORT_MODE environment variable if available, otherwise defaults to "TomTomMCPSDKHttp"
 */
export function setHttpMode(): void {
  isHttpMode = true;
  
  // Get custom MCP transport from environment variable or use default
  // Check for both undefined and empty string cases
  const mcpTransportModeType = process.env.MCP_TRANSPORT_MODE && process.env.MCP_TRANSPORT_MODE.trim() ?
    process.env.MCP_TRANSPORT_MODE.trim() : "TomTomMCPSDKHttp";

  // Update the user-agent header to reflect HTTP mode
  if (tomtomClient.defaults.headers) {
    tomtomClient.defaults.headers["TomTom-User-Agent"] = `${mcpTransportModeType}/${VERSION}`;
  }
  
  logger.debug(`TomTom MCP client set to HTTP mode, user-agent updated to ${mcpTransportModeType}/${VERSION}`);
}

/**
 * Export the getApiKeyFromEnv function for access in other modules
 */
export { getApiKeyFromEnv };

/**
 * API version constants for Genesis API
 * Each API has its own version number which can change independently
 */
export const API_VERSION = {
  SEARCH: 2,
  GEOCODING: 2,
  ROUTING: 1,
  TRAFFIC: 5,
  MAP: 1,
} as const;

/**
 * API version constants for Orbis API
 * Each API has its own version number which can be different from Genesis API
 */
export const ORBIS_API_VERSION = {
  SEARCH: 1,
  GEOCODING: 1,
  ROUTING: 2,
  TRAFFIC: 1,
  MAP: 1,
} as const;
