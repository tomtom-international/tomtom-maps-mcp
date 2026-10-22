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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { APP_DATA, type AppDataReport } from "../../handlers/shared/appData";
import { logger } from "../../utils/logger";
import { appDataOf, registerTomTomAppTool } from "./registerTomTomAppTool";

const tooLarge: AppDataReport = { delivery: "too_large", json_chars: 2_000_000 };

/** A server with one app tool whose app data was too large for the result. */
function serverWithTool(refetch?: boolean) {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const handler = vi.fn(async () => ({
    content: [{ type: "text" as const, text: JSON.stringify({ summary: {} }) }],
    [APP_DATA]: { data: { big: true }, report: tooLarge },
  }));
  registerTomTomAppTool(
    server,
    {
      name: "tomtom-test",
      title: "Test",
      description: "Test tool",
      inputSchema: { query: z.string(), show_ui: z.boolean().optional() },
      app: "map/places-and-routes",
      refetch,
    },
    handler as never
  );
  const tools = (
    server as unknown as {
      _registeredTools: Record<
        string,
        { handler: (args: unknown, extra: unknown) => Promise<unknown> }
      >;
    }
  )._registeredTools;
  const call = (args: Record<string, unknown>) =>
    tools["tomtom-test"].handler(args, { sessionId: undefined, requestInfo: undefined });
  return { server, handler, call };
}

describe("registerTomTomAppTool", () => {
  afterEach(() => vi.restoreAllMocks());

  it("warns that a tool without refetch leaves its app nothing to draw when the data is too large", async () => {
    const warn = vi.spyOn(logger, "warn");
    const { call } = serverWithTool();

    await call({ query: "x" });

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "tomtom-test", delivery: "too_large" }),
      "App data too large for the result: the app can't draw"
    );
  });

  it("logs a refetch tool's too-large data as information, since its app runs it again", async () => {
    const info = vi.spyOn(logger, "info");
    const warn = vi.spyOn(logger, "warn");
    const { call } = serverWithTool(true);

    await call({ query: "x" });

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "tomtom-test", delivery: "too_large" }),
      "App data"
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("runs only a refetch tool again for its app data", async () => {
    const plain = serverWithTool();
    const refetch = serverWithTool(true);
    const extra = {} as Parameters<typeof appDataOf>[3];

    await expect(appDataOf(plain.server, "tomtom-test", { query: "x" }, extra)).rejects.toThrow(
      "The tool doesn't run again for its app data: only tomtom-data-viz does."
    );
    expect(plain.handler).not.toHaveBeenCalled();
    const { appData } = await appDataOf(refetch.server, "tomtom-test", { query: "x" }, extra);
    expect(appData?.data).toEqual({ big: true });
    expect(refetch.handler).toHaveBeenCalledWith({ query: "x", show_ui: true }, extra);
  });
});
