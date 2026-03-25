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
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const mockGetEffectiveApiKey = vi.fn();
const mockGetVizData = vi.fn();

// Capture the handler callbacks passed to registerAppTool
const registeredHandlers: Record<string, Function> = {};
const mockRegisterAppTool = vi.fn(
  (_server: unknown, name: string, _opts: unknown, handler: Function) => {
    registeredHandlers[name] = handler;
  }
);

vi.mock("@modelcontextprotocol/ext-apps/server", () => ({
  registerAppTool: mockRegisterAppTool,
}));

vi.mock("../services/base/tomtomClient.js", () => ({
  getEffectiveApiKey: mockGetEffectiveApiKey,
}));

vi.mock("../services/cache/vizCache.js", () => ({
  getVizData: mockGetVizData,
}));

const { createAppTools } = await import("./appTools");

describe("createAppTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(registeredHandlers).forEach((k) => delete registeredHandlers[k]);
  });

  it("should register exactly 2 app tools with correct metadata", () => {
    const mockServer = {} as McpServer;
    createAppTools(mockServer);

    expect(mockRegisterAppTool).toHaveBeenCalledTimes(2);
    expect(registeredHandlers["tomtom-get-api-key"]).toBeDefined();
    expect(registeredHandlers["tomtom-get-viz-data"]).toBeDefined();

    // Verify each registration includes proper options
    for (const call of mockRegisterAppTool.mock.calls) {
      const options = call[2];
      expect(options).toHaveProperty("title");
      expect(options).toHaveProperty("description");
      expect(options).toHaveProperty("inputSchema");
      expect(options.annotations.readOnlyHint).toBe(true);
      expect(options.annotations.destructiveHint).toBe(false);
      // App-only visibility
      expect(options._meta.ui.visibility).toEqual(["app"]);
    }
  });

  describe("tomtom-get-api-key handler", () => {
    it("should return API key when available", async () => {
      const mockServer = {} as McpServer;
      createAppTools(mockServer);
      mockGetEffectiveApiKey.mockReturnValue("test-api-key-123");

      const response = await registeredHandlers["tomtom-get-api-key"]();

      expect(response.isError).toBe(false);
      expect(response.content[0].text).toBe("test-api-key-123");
    });

    it("should return error when API key is not available", async () => {
      const mockServer = {} as McpServer;
      createAppTools(mockServer);
      mockGetEffectiveApiKey.mockReturnValue(undefined);

      const response = await registeredHandlers["tomtom-get-api-key"]();

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("not available");
    });
  });

  describe("tomtom-get-viz-data handler", () => {
    it("should return cached visualization data", async () => {
      const mockServer = {} as McpServer;
      createAppTools(mockServer);
      const fakeData = { geojson: { type: "FeatureCollection", features: [] } };
      mockGetVizData.mockResolvedValue(fakeData);

      const response = await registeredHandlers["tomtom-get-viz-data"]({ viz_id: "abc-123" });

      expect(response.isError).toBe(false);
      expect(JSON.parse(response.content[0].text)).toEqual(fakeData);
    });

    it("should return error when viz data is not found", async () => {
      const mockServer = {} as McpServer;
      createAppTools(mockServer);
      mockGetVizData.mockResolvedValue(undefined);

      const response = await registeredHandlers["tomtom-get-viz-data"]({ viz_id: "expired-id" });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("not found");
    });
  });
});
