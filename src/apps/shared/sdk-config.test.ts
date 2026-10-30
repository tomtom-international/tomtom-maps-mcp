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

import type { App } from "@modelcontextprotocol/ext-apps";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api-key", () => ({
  getAPIKey: vi.fn().mockResolvedValue("mcp-app-test-key"),
}));

function mockApp(callServerTool: ReturnType<typeof vi.fn>): App {
  return { callServerTool } as unknown as App;
}

function appConfigResponse(userAgent: string) {
  return {
    isError: false,
    content: [{ type: "text", text: JSON.stringify({ userAgent }) }],
  };
}

// sdk-config and the maps-sdk TomTomConfig singleton hold module state
// (initialized flag, config cache), so re-import fresh modules per test.
async function loadFreshModules() {
  const { ensureTomTomConfigured } = await import("./sdk-config");
  const { TomTomConfig } = await import("@tomtom-org/maps-sdk/core");
  const getGlobalConfig = () => TomTomConfig.instance.get() as unknown as Record<string, unknown>;
  return { ensureTomTomConfigured, getGlobalConfig };
}

describe("ensureTomTomConfigured", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should tag the maps-sdk global config with the server-provided MCP App user-agent", async () => {
    const { ensureTomTomConfigured, getGlobalConfig } = await loadFreshModules();
    const callServerTool = vi
      .fn()
      .mockResolvedValue(appConfigResponse("TomTomMCPAPPHttpTT-TEST/9.9.9"));

    await ensureTomTomConfigured(mockApp(callServerTool));

    const config = getGlobalConfig();
    expect(config.apiKey).toBe("mcp-app-test-key");
    expect(config.language).toBe("en-GB");
    // MCP App traffic must be attributed to the MCP APP layer, not the SDK
    // default "MapsSDKJS/<ver>", carrying the server's deployment dimension.
    expect(config["tomtom-user-agent"]).toBe("TomTomMCPAPPHttpTT-TEST/9.9.9");
    expect(callServerTool).toHaveBeenCalledWith({
      name: "tomtom-get-app-config",
      arguments: {},
    });
  });

  it("should throw when the config tool fails instead of emitting dimensionless analytics", async () => {
    const { ensureTomTomConfigured } = await loadFreshModules();
    const callServerTool = vi.fn().mockResolvedValue({ isError: true, content: [] });

    await expect(ensureTomTomConfigured(mockApp(callServerTool))).rejects.toThrow(
      /invalid app config response/
    );
  });

  it("should throw when the config response is missing the userAgent value", async () => {
    const { ensureTomTomConfigured } = await loadFreshModules();
    const callServerTool = vi.fn().mockResolvedValue({
      isError: false,
      content: [{ type: "text", text: JSON.stringify({}) }],
    });

    await expect(ensureTomTomConfigured(mockApp(callServerTool))).rejects.toThrow(
      /missing the userAgent value/
    );
  });

  it("should stay uninitialized after a failure so the next call can retry", async () => {
    const { ensureTomTomConfigured, getGlobalConfig } = await loadFreshModules();
    const callServerTool = vi
      .fn()
      .mockRejectedValueOnce(new Error("tool unavailable"))
      .mockResolvedValue(appConfigResponse("TomTomMCPAPP/1.0.0"));

    await expect(ensureTomTomConfigured(mockApp(callServerTool))).rejects.toThrow();
    await ensureTomTomConfigured(mockApp(callServerTool));

    expect(getGlobalConfig()["tomtom-user-agent"]).toBe("TomTomMCPAPP/1.0.0");
  });

  it("should initialize only once", async () => {
    const { ensureTomTomConfigured } = await loadFreshModules();
    const callServerTool = vi.fn().mockResolvedValue(appConfigResponse("TomTomMCPAPP/1.0.0"));
    const app = mockApp(callServerTool);

    await ensureTomTomConfigured(app);
    await ensureTomTomConfigured(app);

    expect(callServerTool).toHaveBeenCalledTimes(1);
  });
});
