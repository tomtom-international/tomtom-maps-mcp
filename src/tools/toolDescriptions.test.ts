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
import type { ZodType } from "zod";
import { describe, expect, it, vi } from "vitest";

const mockRegisterAppTool = vi.fn();

vi.mock("@modelcontextprotocol/ext-apps/server", () => ({
  registerAppTool: mockRegisterAppTool,
  RESOURCE_URI_META_KEY: "resourceUri",
}));

vi.mock("./helpers/resourceRegistry", () => ({
  registerAppResourceFromPath: vi.fn().mockResolvedValue(undefined),
}));

const { createRoutingTools } = await import("./routingTools");
const { createSearchTools } = await import("./searchTools");
const { createTrafficTools } = await import("./trafficTools");
const { createMapTools } = await import("./mapTools");

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, ZodType>;
}

function register(create: (server: McpServer) => void): Tool[] {
  mockRegisterAppTool.mockClear();
  create({} as McpServer);
  return mockRegisterAppTool.mock.calls.map(([, name, options]) => ({ name, ...options }));
}

const dataTools = [
  ...register(createRoutingTools),
  ...register(createSearchTools),
  ...register(createTrafficTools),
];
const [dynamicMap] = register(createMapTools);

const offersGeometry = (tool: Tool) =>
  tool.inputSchema.response_detail?.safeParse("geometry").success === true;

describe("tool descriptions", () => {
  it.each(dataTools.map((tool) => [tool.name, tool] as const))(
    "%s says what it omits unless response_detail is 'geometry', exactly when it offers it",
    (_name, tool) => {
      const note = /omitted unless response_detail is 'geometry'\.$/;
      if (offersGeometry(tool)) expect(tool.description).toMatch(note);
      else expect(tool.description).not.toMatch(note);
    }
  );

  it("no data tool sends the agent to the dynamic map", () => {
    for (const tool of dataTools) expect(tool.description, tool.name).not.toMatch(/dynamic-map/);
  });

  it("the dynamic map says it returns no route or area geometry, and where to get it", () => {
    expect(dynamicMap.description).toMatch(/never route lines or area outlines/);
    expect(dynamicMap.description).toMatch(/response_detail offers 'geometry'/);
  });
});
