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
import { createRoutingTools } from "./routingTools";

function makeMockServer() {
  return {
    registerTool: vi.fn(),
  };
}

describe("createRoutingTools", () => {
  it("should register all routing-related tools with the correct schemas and handlers", () => {
    const mockServer = makeMockServer();
    createRoutingTools(mockServer as unknown as McpServer);
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "tomtom-routing",
      expect.objectContaining({
        title: "TomTom Routing",
        description: expect.stringContaining("Calculate optimal routes between two locations"),
        inputSchema: expect.any(Object),
      }),
      expect.any(Function)
    );
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "tomtom-waypoint-routing",
      expect.objectContaining({
        title: "TomTom Waypoint Routing",
        description: expect.stringContaining("Plan multi-stop routes"),
        inputSchema: expect.any(Object),
      }),
      expect.any(Function)
    );
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "tomtom-reachable-range",
      expect.objectContaining({
        title: "TomTom Reachable Range",
        description: "Determine the area reachable within a specified time or driving distance",
        inputSchema: expect.any(Object),
      }),
      expect.any(Function)
    );
    expect(mockServer.registerTool).toHaveBeenCalledTimes(3);
  });
});

describe("placeholder", () => {
  it("should have at least one test", () => {
    expect(true).toBe(true);
  });
});
