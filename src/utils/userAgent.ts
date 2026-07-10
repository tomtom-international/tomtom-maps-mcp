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
 * Central definition of the user-agent identifiers this MCP sends to the
 * TomTom APIs. The API gateway extracts them into the `sdk_name` analytics
 * column (value split on "/": name -> sdk_name, version -> its own column),
 * which is what our usage dashboards key on.
 *
 * Naming convention: TomTomMCP<Channel>[<Mode>][<EnvSuffix>]
 *   - Channel "SDK" = MCP server traffic, "UI" = browser widget traffic.
 *     Channel tokens are disjoint so `startswith` filters stay unambiguous:
 *       startswith "TomTomMCP"    -> all Maps MCP traffic
 *       startswith "TomTomMCPSDK" -> server only
 *       startswith "TomTomMCPUI"  -> widgets only
 *   - Mode "Http" is appended when running as an HTTP server (absent = stdio).
 *   - EnvSuffix (e.g. "TT-PROD") comes from the MCP_TRANSPORT_MODE env var,
 *     which overrides the full server name in HTTP mode. Full env-suffixed
 *     values (e.g. TomTomMCPUIHttpTT-PROD) are therefore runtime-derived and
 *     cannot be listed as constants here.
 *
 * This file must stay browser-safe (no Node.js imports): it is bundled into
 * the MCP App widgets as well as the server.
 */

import { VERSION } from "../version";

/** HTTP header carrying the identifier on axios (direct REST) calls */
export const TOMTOM_USER_AGENT_HEADER = "TomTom-User-Agent";

/**
 * maps-sdk global config key read at request time (services) and map
 * construction (tiles/styles). Absent from the SDK's public GlobalConfig
 * type — callers must cast the put() argument.
 */
export const SDK_USER_AGENT_CONFIG_KEY = "tomtom-user-agent";

/** Server user-agent name in stdio mode (local installs) */
export const MCP_SERVER_USER_AGENT_STDIO = "TomTomMCPSDK";

/** Server user-agent name in HTTP mode (default when MCP_TRANSPORT_MODE is unset) */
export const MCP_SERVER_USER_AGENT_HTTP = "TomTomMCPSDKHttp";

/** Widget user-agent name for stdio-served widgets; also the fallback when the widget cannot reach the server config */
export const MCP_UI_USER_AGENT_STDIO = "TomTomMCPUI";

/** Widget user-agent name for HTTP-served widgets; env suffix appended at runtime (e.g. TomTomMCPUIHttpTT-PROD) */
export const MCP_UI_USER_AGENT_HTTP = "TomTomMCPUIHttp";

/**
 * Builds the full user-agent value sent on the wire
 *
 * @param name - User-agent name (e.g. "TomTomMCPSDKHttpTT-PROD")
 * @returns The versioned value (e.g. "TomTomMCPSDKHttpTT-PROD/1.6.5")
 */
export function buildUserAgent(name: string): string {
  return `${name}/${VERSION}`;
}

/**
 * Derives the widget (UI) user-agent name from a server user-agent name so
 * widget traffic carries the same deployment dimension, mapping each server
 * constant to its UI counterpart and carrying any env suffix over:
 *   TomTomMCPSDK            -> TomTomMCPUI
 *   TomTomMCPSDKHttp        -> TomTomMCPUIHttp
 *   TomTomMCPSDKHttpTT-PROD -> TomTomMCPUIHttpTT-PROD
 * Custom MCP_TRANSPORT_MODE values outside the convention get a "UI" suffix
 * appended so widget traffic stays distinguishable from server traffic.
 *
 * @param serverName - The server's current user-agent name
 * @returns The corresponding UI user-agent name
 */
export function deriveUiUserAgentName(serverName: string): string {
  if (serverName === MCP_SERVER_USER_AGENT_STDIO) {
    return MCP_UI_USER_AGENT_STDIO;
  }
  if (serverName.startsWith(MCP_SERVER_USER_AGENT_HTTP)) {
    const envSuffix = serverName.slice(MCP_SERVER_USER_AGENT_HTTP.length);
    return `${MCP_UI_USER_AGENT_HTTP}${envSuffix}`;
  }
  return `${serverName}UI`;
}
