/*
 * Copyright (C) 2025 TomTom NV
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
import { createRoutingTools } from "./routingTools";

function makeMockServer() {
  return {
    tool: vi.fn(),
  };
}

describe("createRoutingTools", () => {
  it("should register all routing-related tools with the correct schemas and handlers", () => {
    const mockServer = makeMockServer();
    createRoutingTools(mockServer as any);
    expect(mockServer.tool).toHaveBeenCalledWith(
      "tomtom-routing",
      "Calculate optimal routes between locations",
      expect.any(Object),
      expect.any(Function)
    );
    expect(mockServer.tool).toHaveBeenCalledWith(
      "tomtom-waypoint-routing",
      "Multi-stop route planning Routing API",
      expect.any(Object),
      expect.any(Function)
    );
    expect(mockServer.tool).toHaveBeenCalledWith(
      "tomtom-reachable-range",
      "Determine coverage areas by time/distance",
      expect.any(Object),
      expect.any(Function)
    );
    expect(mockServer.tool).toHaveBeenCalledTimes(3);
  });
});

describe("placeholder", () => {
  it("should have at least one test", () => {
    expect(true).toBe(true);
  });
});
