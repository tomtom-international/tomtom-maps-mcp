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

const { registerTools } = await import("./register");
const { TOOL_ENTRIES } = await import("./tool-registry");

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

  it("registers one app resource per tool that has an app", async () => {
    await registerTools({} as McpServer);

    const withApps = TOOL_ENTRIES.filter((entry) => entry.app);
    expect(mockRegisterAppResourceFromPath).toHaveBeenCalledTimes(withApps.length);
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

    for (const [name, options] of Object.entries(registrationsByName())) {
      const annotations = options.annotations as Record<string, unknown>;
      expect(annotations, name).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
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
      "ui://tomtom-search/poi-search/app.html"
    );
  });

  it("marks app-internal tools app-only and leaves agent tools visible", async () => {
    await registerTools({} as McpServer);
    const registrations = registrationsByName();

    expect((registrations["tomtom-get-dataset"]._meta as Record<string, unknown>).ui).toEqual({
      visibility: ["app"],
    });
    expect(
      (registrations["tomtom-discover-places"]._meta as Record<string, unknown>).ui
    ).toBeUndefined();
  });

  it("passes each row's own handler through", async () => {
    await registerTools({} as McpServer);

    const handlers = Object.fromEntries(
      (mockRegisterAppTool.mock.calls as Registration[]).map((call) => [call[1], call[3]])
    );
    for (const entry of TOOL_ENTRIES) {
      expect(handlers[entry.name], entry.name).toBe(entry.handler);
    }
  });
});
