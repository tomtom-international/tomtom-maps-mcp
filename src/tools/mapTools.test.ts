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
import { createMapTools } from "./mapTools";

// Mock server and dependencies
function makeMockServer() {
  return {
    tool: vi.fn(),
  };
}

describe("createMapTools", () => {
  it("should register the tomtom-static-map tool with the correct schema and handler", () => {
    const mockServer = makeMockServer();
    createMapTools(mockServer as any);

    expect(mockServer.tool).toHaveBeenCalledWith(
      "tomtom-static-map",
      "Generate custom map images from TomTom Maps with specified center coordinates, zoom levels, and style options", 
      expect.any(Object), // schema
      expect.any(Function) // handler
    );
  });

  it("should register the tomtom-dynamic-map tool with the correct schema and handler", () => {
    const mockServer = makeMockServer();
    createMapTools(mockServer as any);

    expect(mockServer.tool).toHaveBeenCalledWith(
      "tomtom-dynamic-map",
      "Advanced map rendering with custom markers, routes, polygons, and traffic visualization using server-side rendering",
      expect.any(Object), // schema
      expect.any(Function) // handler
    );
  });

  it("should register both map tools", () => {
    const mockServer = makeMockServer();
    createMapTools(mockServer as any);

    expect(mockServer.tool).toHaveBeenCalledTimes(2);
  });
});

describe("placeholder", () => {
  it("should have at least one test", () => {
    expect(true).toBe(true);
  });
});
