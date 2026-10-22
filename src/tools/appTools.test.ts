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

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VERSION } from "../version";

const mockGetEffectiveApiKey = vi.fn();
const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

// Capture the handler callbacks passed to registerAppTool
type ToolResponse = {
  content: { type: string; text: string }[];
  isError: boolean;
};
const registeredHandlers: Record<string, (...args: any[]) => Promise<ToolResponse>> = {};
const mockRegisterAppTool = vi.fn(
  (
    _server: unknown,
    name: string,
    _opts: unknown,
    handler: (...args: any[]) => Promise<ToolResponse>
  ) => {
    registeredHandlers[name] = handler;
  }
);

vi.mock("@modelcontextprotocol/ext-apps/server", () => ({
  registerAppTool: mockRegisterAppTool,
}));

vi.mock("../services/base/tomtomClient.js", () => ({
  getEffectiveApiKey: mockGetEffectiveApiKey,
  serverUserAgentName: "TomTomMCPSDKHttpTT-PROD",
}));

vi.mock("../utils/logger.js", () => ({ logger: mockLogger }));

const mockAppDataOf = vi.fn();
vi.mock("./helpers/registerTomTomAppTool.js", () => ({ appDataOf: mockAppDataOf }));

const { createAppTools } = await import("./appTools");

describe("createAppTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const name of Object.keys(registeredHandlers)) delete registeredHandlers[name];
  });

  it("should register exactly 4 app tools with correct metadata", () => {
    const mockServer = {} as McpServer;
    createAppTools(mockServer);

    expect(mockRegisterAppTool).toHaveBeenCalledTimes(4);
    expect(Object.keys(registeredHandlers).sort()).toEqual([
      "tomtom-get-api-key",
      "tomtom-get-app-config",
      "tomtom-get-app-data",
      "tomtom-report-app-status",
    ]);

    // Verify each registration includes proper options
    for (const call of mockRegisterAppTool.mock.calls) {
      const options = call[2] as Record<string, unknown>;
      expect(options).toHaveProperty("title");
      expect(options).toHaveProperty("description");
      expect(options).toHaveProperty("inputSchema");
      expect((options.annotations as Record<string, unknown>).readOnlyHint).toBe(true);
      expect((options.annotations as Record<string, unknown>).destructiveHint).toBe(false);
      // App-only visibility
      expect((options._meta as Record<string, unknown>).ui).toEqual({ visibility: ["app"] });
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

  describe("tomtom-get-app-config handler", () => {
    it("should return the MCP App user-agent derived from the server identity", async () => {
      const mockServer = {} as McpServer;
      createAppTools(mockServer);

      const response = await registeredHandlers["tomtom-get-app-config"]();

      expect(response.isError).toBe(false);
      // Server identity mocked as TomTomMCPSDKHttpTT-PROD: same dimensions,
      // layer token swapped
      expect(JSON.parse(response.content[0].text)).toEqual({
        userAgent: `TomTomMCPAPPHttpTT-PROD/${VERSION}`,
      });
    });
  });

  describe("tomtom-get-app-data handler", () => {
    const server = { server: { getClientVersion: () => undefined } };
    const params = { tool: "tomtom-traffic", arguments: {}, reason: "not_inline" };

    it("answers unavailable and warns when the tool gives the app no data", async () => {
      mockAppDataOf.mockResolvedValue({ result: { content: [] } });
      createAppTools(server as unknown as McpServer);

      const response = await registeredHandlers["tomtom-get-app-data"](params, {});

      expect(response).toEqual({
        content: [{ type: "text", text: "App data unavailable" }],
        isError: true,
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ tool: "tomtom-traffic", reason: "not_inline" }),
        "App data fetch failed"
      );
    });

    it("passes on the tool's own error when its run fails", async () => {
      const failed = { content: [{ type: "text", text: "API error" }], isError: true };
      mockAppDataOf.mockResolvedValue({ result: failed });
      createAppTools(server as unknown as McpServer);

      expect(await registeredHandlers["tomtom-get-app-data"](params, {})).toBe(failed);
    });

    it("answers the data, logged at info, when it was too large to inline", async () => {
      const report = { delivery: "too_large", json_chars: 200_000 };
      mockAppDataOf.mockResolvedValue({ appData: { data: { lines: 1 }, report }, result: {} });
      createAppTools(server as unknown as McpServer);

      const response = await registeredHandlers["tomtom-get-app-data"](params, {});

      expect(JSON.parse(response.content[0].text)).toEqual({ lines: 1 });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ tool: "tomtom-traffic", ...report }),
        "App data fetched"
      );
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it.each([
      ["not_inline", "App data fetched: host dropped it"],
      ["decode_failed", "App data fetched: app failed to decode it"],
    ])("warns, for data that was inline and fetched as %s, %j", async (reason, message) => {
      const report = { delivery: "inline", json_chars: 900, inline_chars: 400 };
      mockAppDataOf.mockResolvedValue({ appData: { data: {}, report }, result: {} });
      createAppTools(server as unknown as McpServer);

      await registeredHandlers["tomtom-get-app-data"]({ ...params, reason }, {});

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ reason, delivery: "inline" }),
        message
      );
    });
  });

  describe("tomtom-report-app-status handler", () => {
    const server = { server: { getClientVersion: () => ({ name: "claude-ai", version: "1" }) } };
    const extra = { requestInfo: { headers: { "user-agent": "Claude-User" } } };

    it("logs a drawn app at info, with who drew it", async () => {
      createAppTools(server as unknown as McpServer);

      const params = {
        tool: "tomtom-routing",
        status: "drawn",
        source: "inline",
        duration_ms: 812,
      };
      await registeredHandlers["tomtom-report-app-status"](params, extra);

      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          ...params,
          client: "claude-ai",
          user_agent: "Claude-User",
        },
        "App drawn"
      );
    });

    it("logs a failed app at warn", async () => {
      createAppTools(server as unknown as McpServer);

      const params = { tool: "tomtom-routing", status: "failed", stage: "data", error: "timeout" };
      await registeredHandlers["tomtom-report-app-status"](params, extra);

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.objectContaining(params), "App failed");
    });

    it("logs no API key from a failed app's error", async () => {
      mockGetEffectiveApiKey.mockReturnValue("SessionKey123");
      createAppTools(server as unknown as McpServer);

      const style =
        "https://api.tomtom.com/maps/orbis/assets/styles/0.6.0/style.json?map=basic_street-light&key=";
      const params = {
        tool: "tomtom-routing",
        status: "failed",
        stage: "draw",
        error: `AJAXError: Forbidden (403): ${style}OtherKey456&apiVersion=1, key SessionKey123`,
      };
      await registeredHandlers["tomtom-report-app-status"](params, extra);

      const [[fields]] = mockLogger.warn.mock.calls;
      expect(fields.error).toBe(
        `AJAXError: Forbidden (403): ${style}REDACTED&apiVersion=1, key REDACTED`
      );
    });
  });
});
