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
 *
 * SDK = server traffic, APP = MCP App (browser) traffic derived from the
 * server identity with only the layer token swapped. Http = HTTP transport
 * (absent = stdio). TT-<ENV> = TomTom-managed deployment, injected via
 * MCP_TRANSPORT_MODE. Rules: new categories get new token values (never
 * suffix an existing complete value — dashboards match with startswith),
 * and values from different product families must not prefix one another.
 *
 * Every name is minted through userAgentName() below, so a value outside
 * the grammar cannot reach the wire.
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

/** The naming grammar — single source of truth for every identifier */
export const USER_AGENT_NAME_GRAMMAR =
  /^TomTom(?<product>[A-Za-z]+)?MCP(?<layer>SDK|APP)(?<http>Http)?(?<env>TT-[A-Z0-9]+)?$/;

/** A user-agent name proven to match the grammar. Mint via userAgentName(). */
export type UserAgentName = string & { readonly __userAgentName: unique symbol };

/** Validates a name against the grammar — the only way to mint a UserAgentName */
export function userAgentName(value: string): UserAgentName {
  if (!USER_AGENT_NAME_GRAMMAR.test(value)) {
    throw new Error(
      `User-agent name "${value}" is outside the naming grammar ` +
        `${USER_AGENT_NAME_GRAMMAR} (e.g. "TomTomMCPSDKHttpTT-PROD")`
    );
  }
  return value as UserAgentName;
}

/** Server user-agent name in stdio mode (local installs) */
export const MCP_SERVER_USER_AGENT_STDIO = userAgentName("TomTomMCPSDK");

/** Server user-agent name in HTTP mode (default when MCP_TRANSPORT_MODE is unset) */
export const MCP_SERVER_USER_AGENT_HTTP = userAgentName("TomTomMCPSDKHttp");

/**
 * Resolves the HTTP server identity from an optional override (set via
 * MCP_TRANSPORT_MODE): unset/empty falls back to the default, anything else
 * must be an SDK-layer HTTP name within the grammar.
 */
export function resolveHttpServerUserAgentName(override?: string): UserAgentName {
  const value = override?.trim();
  if (!value) {
    return MCP_SERVER_USER_AGENT_HTTP;
  }

  
  const groups = USER_AGENT_NAME_GRAMMAR.exec(value)?.groups;
  if (!groups || groups.layer !== "SDK" || !groups.http) {
    throw new Error(
      `Invalid user-agent name "${value}" (set via MCP_TRANSPORT_MODE): must be ` +
        `an SDK-layer HTTP name in the grammar ${USER_AGENT_NAME_GRAMMAR}, ` +
        `e.g. "TomTomMCPSDKHttpTT-PROD"`
    );
  }
  return value as UserAgentName;
}

/** Builds the versioned wire value the gateway splits on "/", e.g. "TomTomMCPSDK/1.6.5" */
export function buildUserAgent(name: UserAgentName): string {
  return `${name}/${VERSION}`;
}

/** Derives the MCP App name from a server name: same dimensions, layer token SDK -> APP */
export function deriveMcpAppUserAgentName(serverName: UserAgentName): UserAgentName {
  const groups = USER_AGENT_NAME_GRAMMAR.exec(serverName)?.groups;
  if (!groups || groups.layer !== "SDK") {
    throw new Error(`Cannot derive MCP App user-agent from "${serverName}": not an SDK-layer name`);
  }
  return `TomTom${groups.product ?? ""}MCPAPP${groups.http ?? ""}${groups.env ?? ""}` as UserAgentName;
}
