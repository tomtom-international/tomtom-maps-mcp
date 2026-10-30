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
 *
 * The app-only handlers, tested directly. Their registration is covered with
 * every other tool's by `register.test.ts`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VERSION } from "../version";
import type { ToolCall, ToolResponse } from "./shared/tool-entry";

const mockGetEffectiveApiKey = vi.fn();
const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock("../services/api-key", () => ({
  getEffectiveApiKey: mockGetEffectiveApiKey,
  serverUserAgentName: "TomTomMCPSDKHttpTT-PROD",
}));

vi.mock("../utils/logger", () => ({ logger: mockLogger }));

const {
  addAppDataRun,
  getApiKeyHandler,
  getAppConfigHandler,
  getAppDataHandler,
  reportAppStatusHandler,
} = await import("./app-tools");
const { APP_DATA } = await import("./shared/app-data");

/** A call from a fresh server, so the runs added for one test don't reach another. */
function callFrom(client?: { name: string; version: string }, headers = {}): ToolCall {
  const server = { server: { getClientVersion: () => client } } as unknown as McpServer;
  return { server, extra: { requestInfo: { headers } } as ToolCall["extra"] };
}

describe("getApiKeyHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return API key when available", async () => {
    mockGetEffectiveApiKey.mockReturnValue("test-api-key-123");

    const response = await getApiKeyHandler();

    expect(response.isError).toBe(false);
    expect(response.content[0].text).toBe("test-api-key-123");
  });

  it("should return error when API key is not available", async () => {
    mockGetEffectiveApiKey.mockReturnValue(undefined);

    const response = await getApiKeyHandler();

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("not available");
  });
});

describe("getAppConfigHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return the MCP App user-agent derived from the server identity", async () => {
    const response = await getAppConfigHandler();

    expect(response.isError).toBe(false);
    // Server identity mocked as TomTomMCPSDKHttpTT-PROD: same dimensions,
    // layer token swapped
    expect(JSON.parse(response.content[0].text)).toEqual({
      userAgent: `TomTomMCPAPPHttpTT-PROD/${VERSION}`,
    });
  });
});

describe("getAppDataHandler", () => {
  const params = { tool: "tomtom-data-viz", arguments: {}, reason: "not_inline" as const };

  beforeEach(() => vi.clearAllMocks());

  /** A call whose server runs tomtom-data-viz again with `result`. */
  function callRunning(result: ToolResponse): ToolCall {
    const call = callFrom();
    addAppDataRun(call.server, "tomtom-data-viz", async () => result);
    return call;
  }

  it("refuses, and warns, for a tool that doesn't run again", async () => {
    const response = await getAppDataHandler({ ...params, tool: "tomtom-plan-route" }, callFrom());

    expect(response.isError).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "tomtom-plan-route" }),
      "App data fetch failed"
    );
  });

  it("answers unavailable and warns when the tool gives the app no data", async () => {
    const response = await getAppDataHandler(params, callRunning({ content: [] }));

    expect(response).toEqual({
      content: [{ type: "text", text: "App data unavailable" }],
      isError: true,
    });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "tomtom-data-viz", reason: "not_inline" }),
      "App data fetch failed"
    );
  });

  it("passes on the tool's own error when its run fails", async () => {
    const failed: ToolResponse = { content: [{ type: "text", text: "API error" }], isError: true };

    expect(await getAppDataHandler(params, callRunning(failed))).toBe(failed);
  });

  it("answers the data, logged at info, when it was too large to inline", async () => {
    const report = { delivery: "too_large" as const, json_chars: 200_000 };
    const call = callRunning({ content: [], [APP_DATA]: { data: { lines: 1 }, report } });

    const response = await getAppDataHandler(params, call);

    expect(JSON.parse(response.content[0].text)).toEqual({ lines: 1 });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "tomtom-data-viz", ...report }),
      "App data fetched"
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it.each([
    ["not_inline", "App data fetched: host dropped it"],
    ["decode_failed", "App data fetched: app failed to decode it"],
  ] as const)("warns, for data that was inline and fetched as %s, %j", async (reason, message) => {
    const report = { delivery: "inline" as const, json_chars: 900, inline_chars: 400 };
    const call = callRunning({ content: [], [APP_DATA]: { data: {}, report } });

    await getAppDataHandler({ ...params, reason }, call);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason, delivery: "inline" }),
      message
    );
  });
});

describe("reportAppStatusHandler", () => {
  const call = callFrom({ name: "claude-ai", version: "1" }, { "user-agent": "Claude-User" });

  beforeEach(() => vi.clearAllMocks());

  it("logs a drawn app at info, with who drew it", async () => {
    const params = {
      tool: "tomtom-plan-route",
      status: "drawn" as const,
      source: "inline" as const,
      duration_ms: 812,
    };
    await reportAppStatusHandler(params, call);

    expect(mockLogger.info).toHaveBeenCalledWith(
      { ...params, client: "claude-ai", user_agent: "Claude-User" },
      "App drawn"
    );
  });

  it("logs a failed app at warn", async () => {
    const params = {
      tool: "tomtom-plan-route",
      status: "failed" as const,
      stage: "data" as const,
      error: "timeout",
    };
    await reportAppStatusHandler(params, call);

    expect(mockLogger.warn).toHaveBeenCalledWith(expect.objectContaining(params), "App failed");
  });

  it("logs no API key from a failed app's error", async () => {
    mockGetEffectiveApiKey.mockReturnValue("SessionKey123");
    const style =
      "https://api.tomtom.com/maps/orbis/assets/styles/0.6.0/style.json?map=basic_street-light&key=";

    await reportAppStatusHandler(
      {
        tool: "tomtom-plan-route",
        status: "failed",
        stage: "draw",
        error: `AJAXError: Forbidden (403): ${style}OtherKey456&apiVersion=1, key SessionKey123`,
      },
      call
    );

    const [[fields]] = mockLogger.warn.mock.calls;
    expect(fields.error).toBe(
      `AJAXError: Forbidden (403): ${style}REDACTED&apiVersion=1, key REDACTED`
    );
  });
});
