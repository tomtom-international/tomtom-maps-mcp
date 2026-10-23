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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { APP_DATA, type AppDataReport } from "./shared/app-data";
import type { ToolEntry, ToolResponse } from "./shared/tool-entry";

const mockRegisterAppTool = vi.fn();
const mockRegisterAppResourceFromPath = vi.fn().mockResolvedValue(undefined);

vi.mock("@modelcontextprotocol/ext-apps/server", () => ({
  registerAppTool: mockRegisterAppTool,
  RESOURCE_URI_META_KEY: "ui/resourceUri",
}));

vi.mock("./shared/resource-registry", () => ({
  registerAppResourceFromPath: mockRegisterAppResourceFromPath,
}));

vi.mock("../utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { registerToolEntry, registerTools } = await import("./register");
const { appDataOf } = await import("./app-tools");
const { TOOL_ENTRIES } = await import("./tool-registry");
const { logger } = await import("../utils/logger");

type Registration = [unknown, string, Record<string, unknown>, unknown];

const registrationsByName = (): Record<string, Record<string, unknown>> =>
  Object.fromEntries(
    (mockRegisterAppTool.mock.calls as Registration[]).map((call) => [call[1], call[2]])
  );

describe("registerTools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers every registry row exactly once", async () => {
    await registerTools({} as McpServer);

    expect(mockRegisterAppTool).toHaveBeenCalledTimes(TOOL_ENTRIES.length);
    expect(Object.keys(registrationsByName()).sort()).toEqual(
      TOOL_ENTRIES.map((entry) => entry.name).sort()
    );
  });

  it("registers each app resource once, however many tools share it", async () => {
    await registerTools({} as McpServer);

    const withApps = TOOL_ENTRIES.filter((entry) => entry.app);
    const uris = new Set(withApps.map((entry) => entry.app?.resourceUri));
    expect(mockRegisterAppResourceFromPath).toHaveBeenCalledTimes(uris.size);
    for (const { app } of withApps) {
      expect(mockRegisterAppResourceFromPath).toHaveBeenCalledWith(
        {},
        app?.resourceUri,
        app?.category,
        app?.appName
      );
    }
  });

  it("applies the shared read-only annotations to every tool", async () => {
    await registerTools({} as McpServer);

    const openWorld = Object.fromEntries(
      TOOL_ENTRIES.map((entry) => [entry.name, entry.openWorldHint ?? true])
    );
    for (const [name, options] of Object.entries(registrationsByName())) {
      const annotations = options.annotations as Record<string, unknown>;
      expect(annotations, name).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: openWorld[name],
      });
      // Both the config title and the annotation title are set, as they were in
      // every hand-written call site.
      expect(annotations.title, name).toBe(options.title);
    }
  });

  it("advertises the resource URI in _meta for app-backed tools", async () => {
    await registerTools({} as McpServer);

    const options = registrationsByName()["tomtom-discover-places"];
    expect((options._meta as Record<string, unknown>)["ui/resourceUri"]).toBe(
      "ui://tomtom-map/places-and-routes/app.html"
    );
  });

  it("marks app-internal tools app-only and leaves agent tools visible", async () => {
    await registerTools({} as McpServer);
    const registrations = registrationsByName();

    expect((registrations["tomtom-get-app-data"]._meta as Record<string, unknown>).ui).toEqual({
      visibility: ["app"],
    });
    expect(
      (registrations["tomtom-discover-places"]._meta as Record<string, unknown>).ui
    ).toBeUndefined();
  });
});

describe("registerToolEntry", () => {
  const tooLarge: AppDataReport = { delivery: "too_large", json_chars: 2_000_000 };
  const server = { server: { getClientVersion: () => undefined } } as unknown as McpServer;
  const extra = { requestInfo: { headers: {} } };

  afterEach(() => vi.clearAllMocks());

  /** One app tool whose app data was too large for the result, and its registered callback. */
  function registerTestTool(refetch?: boolean) {
    const handler = vi.fn(
      async (): Promise<ToolResponse> => ({
        content: [{ type: "text", text: JSON.stringify({ summary: {} }) }],
        [APP_DATA]: { data: { big: true }, report: tooLarge },
      })
    );
    const entry: ToolEntry = {
      name: "tomtom-test",
      title: "Test",
      description: "Test tool",
      inputSchema: { query: z.string(), show_ui: z.boolean().optional() },
      handler,
      app: {
        category: "map",
        appName: "places-and-routes",
        resourceUri: "ui://tomtom-map/places-and-routes/app.html",
      },
      refetch,
    };
    registerToolEntry(server, entry, new Set());
    const callback = (mockRegisterAppTool.mock.lastCall as Registration)[3] as (
      args: unknown,
      extra: unknown
    ) => Promise<ToolResponse>;
    return { handler, call: (args: Record<string, unknown>) => callback(args, extra) };
  }

  it("calls the row's handler with the server and the call's extra", async () => {
    const { handler, call } = registerTestTool();

    await call({ query: "x" });

    expect(handler).toHaveBeenCalledWith({ query: "x" }, { server, extra });
  });

  it("names the tool in the text's _meta, for the app to report", async () => {
    const { call } = registerTestTool();

    const result = await call({ query: "x" });

    expect(JSON.parse(result.content[0].text)._meta).toEqual({ tool: "tomtom-test" });
  });

  it("warns that a tool without refetch leaves its app nothing to draw when the data is too large", async () => {
    const { call } = registerTestTool();

    await call({ query: "x" });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "tomtom-test", delivery: "too_large" }),
      "App data too large for the result: the app can't draw"
    );
  });

  it("logs a refetch tool's too-large data as information, since its app runs it again", async () => {
    const { call } = registerTestTool(true);

    await call({ query: "x" });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "tomtom-test", delivery: "too_large" }),
      "App data"
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("runs only a refetch tool again for its app data", async () => {
    const plainServer = { server: { getClientVersion: () => undefined } } as unknown as McpServer;
    const refetchExtra = extra as Parameters<typeof appDataOf>[3];
    await expect(
      appDataOf(plainServer, "tomtom-test", { query: "x" }, refetchExtra)
    ).rejects.toThrow("The tool doesn't run again for its app data: only tomtom-data-viz does.");

    const { handler } = registerTestTool(true);
    const { appData } = await appDataOf(server, "tomtom-test", { query: "x" }, refetchExtra);

    expect(appData?.data).toEqual({ big: true });
    expect(handler).toHaveBeenCalledWith({ query: "x", show_ui: true }, { server, extra });
  });
});
