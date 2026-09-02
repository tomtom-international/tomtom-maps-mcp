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
 *
 * Renamed from `services/base/tomtomClient.ts`: since the maps-sdk migration
 * its axios instance is gone, and what is left is key resolution (what nearly
 * every caller wanted) and the server user-agent identity.
 */

import { TomTomConfig } from "@tomtom-org/maps-sdk/core";
import { AsyncLocalStorage } from "async_hooks";
import dotenv from "dotenv";
import { getAppConfig } from "../appConfig";
import { logger } from "../utils/logger";
import {
  buildUserAgent,
  MCP_SERVER_USER_AGENT_STDIO,
  resolveHttpServerUserAgentName,
  SDK_USER_AGENT_CONFIG_KEY,
  type UserAgentName,
} from "../utils/userAgent";

// Set by setHttpMode()
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
 * Applies the server identity to the exported live binding and the maps-sdk
 * global config, so SDK service calls are attributed to the MCP and not the
 * SDK's default "MapsSDKJS/<ver>" (the config key is absent from the public
 * GlobalConfig type, hence the cast).
 */
function applyServerIdentity(name: UserAgentName): void {
  serverUserAgentName = name;
  const userAgent = buildUserAgent(name);
  TomTomConfig.instance.put({
    [SDK_USER_AGENT_CONFIG_KEY]: userAgent,
  } as unknown as Parameters<typeof TomTomConfig.instance.put>[0]);
}

// Default to the stdio identity — setHttpMode() overrides it in HTTP mode
applyServerIdentity(MCP_SERVER_USER_AGENT_STDIO);

/**
 * Request context for session-specific configuration
 */
interface RequestContext {
  /** Unset for a request that cannot call the TomTom API, so none was looked up. */
  apiKey: string | undefined;
}

/**
 * AsyncLocalStorage for proper per-request context isolation
 * This ensures multiple concurrent HTTP sessions don't interfere with each other
 */
const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * Run function within a session context (for HTTP requests)
 */
export function runWithSessionContext<T>(apiKey: string | undefined, fn: () => T): T {
  return requestContext.run({ apiKey }, fn);
}

/**
 * Get the effective API key: the request's own inside an HTTP request, never
 * the server's, so a request without one cannot spend the server's key;
 * the environment's otherwise.
 */
export function getEffectiveApiKey(): string | undefined {
  const context = requestContext.getStore();
  return context ? context.apiKey : getStaticApiKey();
}

/**
 * The effective API key, for calls that cannot proceed without one
 * @throws {Error} If the API key is not set
 */
export function requireApiKey(): string {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) {
    throw new Error(
      "TomTom API key is not set. Please set TOMTOM_API_KEY environment variable or provide via session configuration."
    );
  }
  return apiKey;
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
