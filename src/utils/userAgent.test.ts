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

import { describe, it, expect } from "vitest";
import { VERSION } from "../version";
import {
  MCP_SERVER_USER_AGENT_STDIO,
  MCP_SERVER_USER_AGENT_HTTP,
  MCP_APP_USER_AGENT_STDIO,
  MCP_APP_USER_AGENT_HTTP,
  buildUserAgent,
  deriveMcpAppUserAgentName,
} from "./userAgent";

describe("userAgent identifiers", () => {
  it("should keep layer tokens disjoint so startswith filters stay unambiguous", () => {
    // Server-only dashboards filter startswith "TomTomMCPSDK"; MCP App values
    // must never match it (and vice versa).
    expect(MCP_APP_USER_AGENT_STDIO.startsWith(MCP_SERVER_USER_AGENT_STDIO)).toBe(false);
    expect(MCP_APP_USER_AGENT_HTTP.startsWith(MCP_SERVER_USER_AGENT_STDIO)).toBe(false);
    expect(MCP_SERVER_USER_AGENT_STDIO.startsWith(MCP_APP_USER_AGENT_STDIO)).toBe(false);
    // Both layers stay inside the family prefix
    expect(MCP_SERVER_USER_AGENT_STDIO.startsWith("TomTomMCP")).toBe(true);
    expect(MCP_APP_USER_AGENT_STDIO.startsWith("TomTomMCP")).toBe(true);
  });

  it("should keep every constant inside the naming grammar", () => {
    const grammar = /^TomTom([A-Za-z]+)?MCP(SDK|APP)(Http)?(TT-[A-Z0-9]+)?$/;
    expect(MCP_SERVER_USER_AGENT_STDIO).toMatch(grammar);
    expect(MCP_SERVER_USER_AGENT_HTTP).toMatch(grammar);
    expect(MCP_APP_USER_AGENT_STDIO).toMatch(grammar);
    expect(MCP_APP_USER_AGENT_HTTP).toMatch(grammar);
    // Runtime-derived env-suffixed values conform too
    expect(deriveMcpAppUserAgentName("TomTomMCPSDKHttpTT-PROD")).toMatch(grammar);
  });

  it("should build the versioned wire value", () => {
    expect(buildUserAgent("TomTomMCPSDK")).toBe(`TomTomMCPSDK/${VERSION}`);
  });
});

describe("deriveMcpAppUserAgentName", () => {
  it("should map the stdio server name to the stdio APP name", () => {
    expect(deriveMcpAppUserAgentName("TomTomMCPSDK")).toBe("TomTomMCPAPP");
  });

  it("should map the default HTTP server name to the HTTP APP name", () => {
    expect(deriveMcpAppUserAgentName("TomTomMCPSDKHttp")).toBe("TomTomMCPAPPHttp");
  });

  it("should carry the deployment env suffix over", () => {
    expect(deriveMcpAppUserAgentName("TomTomMCPSDKHttpTT-PROD")).toBe("TomTomMCPAPPHttpTT-PROD");
    expect(deriveMcpAppUserAgentName("TomTomMCPSDKHttpTT-DEV")).toBe("TomTomMCPAPPHttpTT-DEV");
  });

  it("should append an APP suffix to custom MCP_TRANSPORT_MODE values outside the convention", () => {
    expect(deriveMcpAppUserAgentName("CustomMCPType")).toBe("CustomMCPTypeAPP");
  });
});
