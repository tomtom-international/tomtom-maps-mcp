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
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const mockRegisterAppTool = vi.fn();
const mockRegisterAppResourceFromPath = vi.fn().mockResolvedValue(undefined);

vi.mock("@modelcontextprotocol/ext-apps/server", () => ({
  registerAppTool: mockRegisterAppTool,
  RESOURCE_URI_META_KEY: "resourceUri",
}));

vi.mock("./helpers/resourceRegistry", () => ({
  registerAppResourceFromPath: mockRegisterAppResourceFromPath,
}));

vi.mock("../handlers/searchOrbisHandler", () => ({
  createGeocodeHandler: vi.fn(() => vi.fn()),
  createReverseGeocodeHandler: vi.fn(() => vi.fn()),
  createFuzzySearchHandler: vi.fn(() => vi.fn()),
  createPoiSearchHandler: vi.fn(() => vi.fn()),
  createNearbySearchHandler: vi.fn(() => vi.fn()),
  createPOICategoriesHandler: vi.fn(() => vi.fn()),
  createAreaSearchHandler: vi.fn(() => vi.fn()),
  createEVSearchHandler: vi.fn(() => vi.fn()),
  createSearchAlongRouteHandler: vi.fn(() => vi.fn()),
}));

const { createSearchOrbisTools } = await import("./searchOrbisTools");

describe("createSearchOrbisTools", () => {
  it("should register all 9 Orbis search tools with correct metadata", async () => {
    const mockServer = {} as McpServer;
    await createSearchOrbisTools(mockServer);

    expect(mockRegisterAppTool).toHaveBeenCalledTimes(9);

    // Verify each tool has name, options with title/description/inputSchema, and a handler
    for (const call of mockRegisterAppTool.mock.calls) {
      const [, name, options, handler] = call;
      expect(typeof name).toBe("string");
      expect(options).toHaveProperty("title");
      expect(options).toHaveProperty("description");
      expect(options).toHaveProperty("inputSchema");
      expect(options._meta.backend).toBe("tomtom-orbis-maps");
      expect(typeof handler).toBe("function");
    }

    const registeredNames = mockRegisterAppTool.mock.calls.map(
      (call: unknown[]) => call[1]
    );
    expect(registeredNames).toEqual(
      expect.arrayContaining([
        "tomtom-geocode",
        "tomtom-reverse-geocode",
        "tomtom-fuzzy-search",
        "tomtom-poi-search",
        "tomtom-nearby",
        "tomtom-poi-categories",
        "tomtom-area-search",
        "tomtom-ev-search",
        "tomtom-search-along-route",
      ])
    );
  });

  it("should register app resources for search tools", async () => {
    const mockServer = {} as McpServer;
    await createSearchOrbisTools(mockServer);

    expect(mockRegisterAppResourceFromPath).toHaveBeenCalled();
    const uris = mockRegisterAppResourceFromPath.mock.calls.map(
      (call: unknown[]) => call[1]
    );
    expect(uris).toContain("ui://tomtom-search/geocode/app.html");
    expect(uris).toContain("ui://tomtom-search/fuzzy-search/app.html");
  });
});
