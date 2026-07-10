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
  TOMTOM_USER_AGENT_HEADER,
  SDK_USER_AGENT_CONFIG_KEY,
  MCP_SERVER_USER_AGENT_STDIO,
  MCP_SERVER_USER_AGENT_HTTP,
  MCP_UI_USER_AGENT_STDIO,
  MCP_UI_USER_AGENT_HTTP,
  buildUserAgent,
  deriveUiUserAgentName,
} from "./userAgent";

describe("userAgent identifiers", () => {
  // Literal values asserted on purpose: these strings are an analytics
  // contract (ADX sdk_name column and dashboard filters key on them), not an
  // implementation detail. Changing one must fail here first.
  it("should match the values the analytics pipeline keys on", () => {
    expect(TOMTOM_USER_AGENT_HEADER).toBe("TomTom-User-Agent");
    expect(SDK_USER_AGENT_CONFIG_KEY).toBe("tomtom-user-agent");
    expect(MCP_SERVER_USER_AGENT_STDIO).toBe("TomTomMCPSDK");
    expect(MCP_SERVER_USER_AGENT_HTTP).toBe("TomTomMCPSDKHttp");
    expect(MCP_UI_USER_AGENT_STDIO).toBe("TomTomMCPUI");
    expect(MCP_UI_USER_AGENT_HTTP).toBe("TomTomMCPUIHttp");
  });

  it("should keep channel prefixes disjoint so startswith filters stay unambiguous", () => {
    // Server-only dashboards filter startswith "TomTomMCPSDK"; widget values
    // must never match it (and vice versa).
    expect(MCP_UI_USER_AGENT_STDIO.startsWith(MCP_SERVER_USER_AGENT_STDIO)).toBe(false);
    expect(MCP_UI_USER_AGENT_HTTP.startsWith(MCP_SERVER_USER_AGENT_STDIO)).toBe(false);
    expect(MCP_SERVER_USER_AGENT_STDIO.startsWith(MCP_UI_USER_AGENT_STDIO)).toBe(false);
    // Both channels stay inside the family prefix
    expect(MCP_SERVER_USER_AGENT_STDIO.startsWith("TomTomMCP")).toBe(true);
    expect(MCP_UI_USER_AGENT_STDIO.startsWith("TomTomMCP")).toBe(true);
  });

  it("should build the versioned wire value", () => {
    expect(buildUserAgent("TomTomMCPSDK")).toBe(`TomTomMCPSDK/${VERSION}`);
  });
});

describe("deriveUiUserAgentName", () => {
  it("should map stdio server name to the stdio UI name", () => {
    expect(deriveUiUserAgentName("TomTomMCPSDK")).toBe("TomTomMCPUI");
  });

  it("should map the default HTTP server name to the HTTP UI name", () => {
    expect(deriveUiUserAgentName("TomTomMCPSDKHttp")).toBe("TomTomMCPUIHttp");
  });

  it("should carry the deployment env suffix over", () => {
    expect(deriveUiUserAgentName("TomTomMCPSDKHttpTT-PROD")).toBe("TomTomMCPUIHttpTT-PROD");
    expect(deriveUiUserAgentName("TomTomMCPSDKHttpTT-DEV")).toBe("TomTomMCPUIHttpTT-DEV");
  });

  it("should append a UI suffix to custom MCP_TRANSPORT_MODE values outside the convention", () => {
    expect(deriveUiUserAgentName("CustomMCPType")).toBe("CustomMCPTypeUI");
  });
});
