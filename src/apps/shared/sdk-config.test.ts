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

import { describe, it, expect, vi } from "vitest";
import type { App } from "@modelcontextprotocol/ext-apps";
import { TomTomConfig } from "@tomtom-org/maps-sdk/core";
import { VERSION } from "../../version";

vi.mock("./api-key", () => ({
  getAPIKey: vi.fn().mockResolvedValue("widget-test-key"),
}));

import { ensureTomTomConfigured } from "./sdk-config";
import { getAPIKey } from "./api-key";

function getGlobalConfig(): Record<string, unknown> {
  return TomTomConfig.instance.get() as unknown as Record<string, unknown>;
}

describe("ensureTomTomConfigured", () => {
  it("should tag the maps-sdk global config with the MCP UI user-agent", async () => {
    await ensureTomTomConfigured({} as App);

    const config = getGlobalConfig();
    expect(config.apiKey).toBe("widget-test-key");
    expect(config.language).toBe("en-GB");
    // Widget traffic must be attributed to the MCP UI, not the SDK default
    // "MapsSDKJS/<ver>". Distinct from the server values (TomTomMCPSDK*) so
    // server vs widget traffic stays separable in analytics.
    expect(config["tomtom-user-agent"]).toBe(`TomTomMCPUI/${VERSION}`);
  });

  it("should initialize only once", async () => {
    await ensureTomTomConfigured({} as App);
    await ensureTomTomConfigured({} as App);

    expect(vi.mocked(getAPIKey)).toHaveBeenCalledTimes(1);
  });
});
