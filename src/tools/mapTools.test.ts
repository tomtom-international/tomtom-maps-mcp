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
import { createMapTools } from "./mapTools";

// Mock server and dependencies
function makeMockServer() {
  return {
    registerTool: vi.fn(),
  };
}

describe("createMapTools", () => {
  it("should register the tomtom-static-map tool with the correct schema and handler", () => {
    const mockServer = makeMockServer();
    createMapTools(mockServer as any);

    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "tomtom-static-map",
      expect.objectContaining({
        title: "TomTom Static Map",
        description:
          "Generate custom map images from TomTom Maps with specified center coordinates, zoom levels, and style options",
        inputSchema: expect.any(Object),
      }),
      expect.any(Function)
    );
  });

  it("should register the tomtom-dynamic-map tool with the correct schema and handler", () => {
    const mockServer = makeMockServer();
    createMapTools(mockServer as any);

    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "tomtom-dynamic-map",
      expect.objectContaining({
        title: "TomTom Dynamic Map",
        description:
          "Advanced map rendering with custom markers, routes, polygons, and traffic visualization using server-side rendering",
        inputSchema: expect.any(Object),
      }),
      expect.any(Function)
    );
  });

  it("should register both map tools", () => {
    const mockServer = makeMockServer();
    createMapTools(mockServer as any);

    expect(mockServer.registerTool).toHaveBeenCalledTimes(2);
  });
});

describe("placeholder", () => {
  it("should have at least one test", () => {
    expect(true).toBe(true);
  });
});
