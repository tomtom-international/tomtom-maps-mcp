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

import { describe, expect, it } from "vitest";
import { VERSION } from "../version";
import {
  buildUserAgent,
  deriveMcpAppUserAgentName,
  MCP_SERVER_USER_AGENT_HTTP,
  MCP_SERVER_USER_AGENT_STDIO,
  resolveHttpServerUserAgentName,
  userAgentName,
} from "./userAgent";

describe("userAgentName", () => {
  it("should mint grammar-conforming names", () => {
    expect(userAgentName("TomTomMCPSDK")).toBe("TomTomMCPSDK");
    expect(userAgentName("TomTomMCPAPPHttpTT-PROD")).toBe("TomTomMCPAPPHttpTT-PROD");
    expect(userAgentName("TomTomTrafficMCPSDKHttpTT-DEV")).toBe("TomTomTrafficMCPSDKHttpTT-DEV");
  });

  it("should reject names outside the grammar", () => {
    expect(() => userAgentName("TomTomMCPWidget")).toThrow(/outside the naming grammar/);
    expect(() => userAgentName("TomTomMCPSDKHttptt-prod")).toThrow(); // casing is load-bearing
    expect(() => userAgentName("TomTomMCPSDKHttpTT-PROD-extra")).toThrow();
  });

  it("should keep layer tokens disjoint so startswith filters stay unambiguous", () => {
    // Server-only dashboards filter startswith "TomTomMCPSDK"; MCP App values
    // must never match it (and vice versa).
    const appName = deriveMcpAppUserAgentName(MCP_SERVER_USER_AGENT_STDIO);
    expect(appName.startsWith(MCP_SERVER_USER_AGENT_STDIO)).toBe(false);
    expect(MCP_SERVER_USER_AGENT_STDIO.startsWith(appName)).toBe(false);
    // Both layers stay inside the family prefix
    expect(MCP_SERVER_USER_AGENT_STDIO.startsWith("TomTomMCP")).toBe(true);
    expect(appName.startsWith("TomTomMCP")).toBe(true);
  });
});

describe("buildUserAgent", () => {
  it("should build the versioned wire value", () => {
    expect(buildUserAgent(MCP_SERVER_USER_AGENT_STDIO)).toBe(`TomTomMCPSDK/${VERSION}`);
  });
});

describe("deriveMcpAppUserAgentName", () => {
  it.each([
    ["TomTomMCPSDK", "TomTomMCPAPP"],
    ["TomTomMCPSDKHttp", "TomTomMCPAPPHttp"],
    ["TomTomMCPSDKHttpTT-PROD", "TomTomMCPAPPHttpTT-PROD"],
    ["TomTomMCPSDKHttpTT-DEV", "TomTomMCPAPPHttpTT-DEV"],
    // Other product families keep their token
    ["TomTomTrafficMCPSDKHttpTT-PROD", "TomTomTrafficMCPAPPHttpTT-PROD"],
  ])("should derive %s -> %s", (server, app) => {
    expect(deriveMcpAppUserAgentName(userAgentName(server))).toBe(app);
  });

  it("should throw on non-SDK-layer names", () => {
    expect(() => deriveMcpAppUserAgentName(userAgentName("TomTomMCPAPPHttp"))).toThrow(
      /not an SDK-layer name/
    );
  });
});

describe("resolveHttpServerUserAgentName", () => {
  it("should return the default HTTP identity when the override is unset or empty", () => {
    expect(resolveHttpServerUserAgentName(undefined)).toBe(MCP_SERVER_USER_AGENT_HTTP);
    expect(resolveHttpServerUserAgentName("")).toBe(MCP_SERVER_USER_AGENT_HTTP);
    expect(resolveHttpServerUserAgentName("  ")).toBe(MCP_SERVER_USER_AGENT_HTTP);
  });

  it("should accept SDK-layer HTTP overrides", () => {
    expect(resolveHttpServerUserAgentName("TomTomMCPSDKHttpTT-PROD")).toBe(
      "TomTomMCPSDKHttpTT-PROD"
    );
    expect(resolveHttpServerUserAgentName("TomTomTrafficMCPSDKHttpTT-DEV")).toBe(
      "TomTomTrafficMCPSDKHttpTT-DEV"
    );
  });

  it("should reject overrides outside the grammar", () => {
    expect(() => resolveHttpServerUserAgentName("CustomMCPType")).toThrow(/MCP_TRANSPORT_MODE/);
    expect(() => resolveHttpServerUserAgentName("TomTomMCPSDK")).toThrow(); // Http mandatory in HTTP mode
    expect(() => resolveHttpServerUserAgentName("TomTomMCPAPPHttp")).toThrow(); // APP is derived, never configured
  });
});
