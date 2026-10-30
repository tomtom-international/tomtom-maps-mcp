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

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

process.env.TOMTOM_API_KEY = "test-api-key";

import { TomTomConfig } from "@tomtom-org/maps-sdk/core";
import { AI_CLIENTS } from "../../testClients";
import { VERSION } from "../../version";
import {
  isHttpMode,
  serverUserAgentName,
  setHttpMode,
  requireApiKey,
  runWithSessionContext,
  setStdioClientName,
  tomtomCallParams,
} from "./tomtomClient";

// The `tomtom-user-agent` key is absent from the public GlobalConfig type
function getSdkUserAgent(): unknown {
  return (TomTomConfig.instance.get() as unknown as Record<string, unknown>)["tomtom-user-agent"];
}

describe("TomTom Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.env.TOMTOM_API_KEY = "test-api-key"; // Restore for most tests
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should return the API key when one is set", () => {
    expect(requireApiKey()).toBeTruthy();
  });

  it("should use the request's own key inside a request", () => {
    expect(
      runWithSessionContext({ apiKey: "request-key", clientName: "claude-code" }, () =>
        requireApiKey()
      )
    ).toBe("request-key");
  });

  it("should never fall back to the server's key inside a request that has none", () => {
    expect(() =>
      runWithSessionContext({ apiKey: undefined, clientName: "claude-code" }, () => requireApiKey())
    ).toThrow(/API key is not set/);
  });

  it("should tag the maps-sdk global config at module load so SDK calls are attributed to the MCP", () => {
    // Without it every SDK call reports the default "MapsSDKJS/<ver>" in API analytics.
    expect(getSdkUserAgent()).toBe(`TomTomMCPSDK/${VERSION} unknown`);
    // Exported live binding consumers derive dependent identities from,
    // e.g. the MCP App user-agent in appTools.ts
    expect(serverUserAgentName).toBe("TomTomMCPSDK");
  });

  it("should switch the user-agent with the mode", () => {
    // Default mode (stdio)
    expect(isHttpMode).toBe(false);
    expect(getSdkUserAgent()).toBe(`TomTomMCPSDK/${VERSION} unknown`);

    // Set HTTP mode (default HTTP identity, no env override)
    setHttpMode();
    expect(isHttpMode).toBe(true);
    expect(getSdkUserAgent()).toBe(`TomTomMCPSDKHttp/${VERSION} unknown`);
    // Live binding follows the mode switch
    expect(serverUserAgentName).toBe("TomTomMCPSDKHttp");
  });

  it("should apply a grammar-conforming MCP_TRANSPORT_MODE override", () => {
    setHttpMode("TomTomMCPSDKHttpTT-PROD");
    expect(isHttpMode).toBe(true);
    expect(getSdkUserAgent()).toBe(`TomTomMCPSDKHttpTT-PROD/${VERSION} unknown`);
    // Live binding exposes the override for dependent-identity derivation
    expect(serverUserAgentName).toBe("TomTomMCPSDKHttpTT-PROD");
  });

  it("should throw on MCP_TRANSPORT_MODE values outside the naming grammar", () => {
    // sdk_name analytics depend on predictable values, so bad config must
    // fail at startup instead of polluting the analytics column
    expect(() => setHttpMode("CustomMCPType")).toThrow(/MCP_TRANSPORT_MODE/);
  });

  it("should use the default identity when the override is unset", () => {
    setHttpMode();
    expect(isHttpMode).toBe(true);
    expect(getSdkUserAgent()).toBe(`TomTomMCPSDKHttp/${VERSION} unknown`);
  });
});

describe("tomtomCallParams", () => {
  beforeEach(() => {
    setHttpMode("TomTomMCPSDKHttpTT-PROD");
  });

  it("should name no client over stdio before one initializes", () => {
    expect(tomtomCallParams()["tomtom-user-agent"]).toBe(
      `TomTomMCPSDKHttpTT-PROD/${VERSION} unknown`
    );
  });

  it.each(AI_CLIENTS)(
    "should pass the session's key and name client $name",
    ({ name, userAgentToken }) => {
      const params = runWithSessionContext({ apiKey: "request-key", clientName: name }, () =>
        tomtomCallParams()
      );

      expect(params).toEqual({
        apiKey: "request-key",
        "tomtom-user-agent": `TomTomMCPSDKHttpTT-PROD/${VERSION} ${userAgentToken}`,
      });
    }
  );

  it("should keep the clients of concurrent sessions apart", async () => {
    const userAgentAfter = async (ms: number) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return tomtomCallParams()["tomtom-user-agent"];
    };

    // Each session waits longer than the next, so their awaits interleave
    const userAgents = await Promise.all(
      AI_CLIENTS.map(({ name }, index) =>
        runWithSessionContext({ apiKey: "request-key", clientName: name }, () =>
          userAgentAfter((AI_CLIENTS.length - index) * 5)
        )
      )
    );

    expect(userAgents).toEqual(
      AI_CLIENTS.map(({ userAgentToken }) => `TomTomMCPSDKHttpTT-PROD/${VERSION} ${userAgentToken}`)
    );
  });

  it("should name the stdio client outside a session once it initializes", () => {
    setStdioClientName("claude-code");

    expect(tomtomCallParams()["tomtom-user-agent"]).toBe(
      `TomTomMCPSDKHttpTT-PROD/${VERSION} claude-code`
    );
  });
});
