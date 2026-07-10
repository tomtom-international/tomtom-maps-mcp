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

/**
 * User-agent identifiers sent to the TomTom APIs. The gateway extracts the
 * name part into the `sdk_name` analytics column our dashboards key on.
 *
 * Naming grammar (casing exact — KQL matching is case-sensitive):
 *
 *   TomTom[<Product>]MCP(SDK|APP)(Http)?(TT-<ENV>)?
 *   ^TomTom([A-Za-z]+)?MCP(SDK|APP)(Http)?(TT-[A-Z0-9]+)?$
 *
 * SDK = server traffic, APP = MCP App (browser) traffic derived from the
 * server identity with only the layer token swapped. Http = HTTP transport
 * (absent = stdio). TT-<ENV> = TomTom-managed deployment, injected via
 * MCP_TRANSPORT_MODE. Rules: new categories get new token values (never
 * suffix an existing complete value — dashboards match with startswith),
 * and values from different product families must not prefix one another.
 *
 * Must stay browser-safe (no Node.js imports): bundled into the MCP Apps.
 */

import { VERSION } from "../version";

/** HTTP header carrying the identifier on axios (direct REST) calls */
export const TOMTOM_USER_AGENT_HEADER = "TomTom-User-Agent";

/**
 * maps-sdk global config key for the same identifier. Absent from the SDK's
 * public GlobalConfig type — callers must cast the put() argument.
 */
export const SDK_USER_AGENT_CONFIG_KEY = "tomtom-user-agent";

/** Server user-agent name in stdio mode (local installs) */
export const MCP_SERVER_USER_AGENT_STDIO = "TomTomMCPSDK";

/** Server user-agent name in HTTP mode (default when MCP_TRANSPORT_MODE is unset) */
export const MCP_SERVER_USER_AGENT_HTTP = "TomTomMCPSDKHttp";

/**
 * Valid MCP_TRANSPORT_MODE overrides: an SDK-layer HTTP server value within
 * the grammar (Http mandatory — the override only applies in HTTP mode).
 */
export const HTTP_SERVER_USER_AGENT_PATTERN = /^TomTom([A-Za-z]+)?MCPSDKHttp(TT-[A-Z0-9]+)?$/;

/** MCP App user-agent name when served by a stdio server */
export const MCP_APP_USER_AGENT_STDIO = "TomTomMCPAPP";

/** MCP App user-agent name when served by an HTTP server; env suffix appended at runtime (e.g. TomTomMCPAPPHttpTT-PROD) */
export const MCP_APP_USER_AGENT_HTTP = "TomTomMCPAPPHttp";

/** Builds the versioned wire value, e.g. "TomTomMCPSDK" -> "TomTomMCPSDK/1.6.5" */
export function buildUserAgent(name: string): string {
  return `${name}/${VERSION}`;
}

/**
 * Derives the MCP App user-agent name from a server user-agent name by
 * swapping the layer token and keeping every other dimension:
 *   TomTomMCPSDK            -> TomTomMCPAPP
 *   TomTomMCPSDKHttpTT-PROD -> TomTomMCPAPPHttpTT-PROD
 * Throws on names outside the grammar; server names are validated at
 * startup (setHttpMode), so a throw here means a bug, not bad config.
 */
export function deriveMcpAppUserAgentName(serverName: string): string {
  if (serverName === MCP_SERVER_USER_AGENT_STDIO) {
    return MCP_APP_USER_AGENT_STDIO;
  }
  if (serverName.startsWith(MCP_SERVER_USER_AGENT_HTTP)) {
    // Keep only the env suffix ("TomTomMCPSDKHttpTT-PROD" -> "TT-PROD", bare
    // default -> "") and rebase it onto the APP HTTP name.
    const envSuffix = serverName.slice(MCP_SERVER_USER_AGENT_HTTP.length);
    return `${MCP_APP_USER_AGENT_HTTP}${envSuffix}`;
  }
  if (serverName.includes("MCPSDK")) {
    // Grammar-conforming value from another product family (e.g.
    // TomTomTrafficMCPSDKHttp): swap the layer token in place.
    return serverName.replace("MCPSDK", "MCPAPP");
  }
  throw new Error(
    `Cannot derive MCP App user-agent from "${serverName}": no SDK layer token in the name`
  );
}
