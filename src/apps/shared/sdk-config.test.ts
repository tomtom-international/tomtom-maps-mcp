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

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { App } from "@modelcontextprotocol/ext-apps";
import { VERSION } from "../../version";

vi.mock("./api-key", () => ({
  getAPIKey: vi.fn().mockResolvedValue("widget-test-key"),
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

// sdk-config, app-config and the maps-sdk TomTomConfig singleton hold module
// state (initialized flags, caches), so re-import fresh modules per test.
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
    expect(config.apiKey).toBe("widget-test-key");
    expect(config.language).toBe("en-GB");
    // MCP App traffic must be attributed to the MCP APP layer, not the SDK
    // default "MapsSDKJS/<ver>", carrying the server's deployment dimension.
    expect(config["tomtom-user-agent"]).toBe("TomTomMCPAPPHttpTT-TEST/9.9.9");
    expect(callServerTool).toHaveBeenCalledWith({
      name: "tomtom-get-app-config",
      arguments: {},
    });
  });

  it("should fall back to the plain APP user-agent when the config tool fails", async () => {
    const { ensureTomTomConfigured, getGlobalConfig } = await loadFreshModules();
    const callServerTool = vi.fn().mockRejectedValue(new Error("tool unavailable"));

    await ensureTomTomConfigured(mockApp(callServerTool));

    expect(getGlobalConfig()["tomtom-user-agent"]).toBe(`TomTomMCPAPP/${VERSION}`);
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
