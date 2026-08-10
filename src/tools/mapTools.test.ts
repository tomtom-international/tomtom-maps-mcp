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
import { describe, expect, it, vi } from "vitest";

const mockRegisterAppTool = vi.fn();

vi.mock("@modelcontextprotocol/ext-apps/server", () => ({
  registerAppTool: mockRegisterAppTool,
  RESOURCE_URI_META_KEY: "resourceUri",
}));

vi.mock("./helpers/resourceRegistry", () => ({
  registerAppResourceFromPath: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../handlers/mapHandler", () => ({
  createDynamicMapHandler: vi.fn(() => vi.fn()),
}));

const { createMapTools } = await import("./mapTools");

describe("createMapTools", () => {
  it("should register tomtom-dynamic-map with its app resource and schema", async () => {
    const mockServer = {} as McpServer;
    await createMapTools(mockServer);

    expect(mockRegisterAppTool).toHaveBeenCalledTimes(1);
    const [, name, options, handler] = mockRegisterAppTool.mock.calls[0];
    expect(name).toBe("tomtom-dynamic-map");
    expect(options).toHaveProperty("inputSchema");
    expect(options).toHaveProperty("description");
    expect(typeof handler).toBe("function");
  });
});
