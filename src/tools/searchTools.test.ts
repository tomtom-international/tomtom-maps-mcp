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
import { createSearchTools } from "./searchTools";

function makeMockServer() {
  return {
    registerTool: vi.fn(),
  };
}

describe("createSearchTools", () => {
  it("should register all search-related tools with the correct schemas and handlers", () => {
    const mockServer = makeMockServer();
    createSearchTools(mockServer as any);
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "tomtom-geocode",
      expect.objectContaining({
        title: "TomTom Geocode",
        description:
          "Convert street addresses to coordinates (does not support points of interest)",
        inputSchema: expect.any(Object),
      }),
      expect.any(Function)
    );
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "tomtom-reverse-geocode",
      expect.objectContaining({
        title: "TomTom Reverse Geocode",
        description: "Convert coordinates to addresses",
        inputSchema: expect.any(Object),
      }),
      expect.any(Function)
    );
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "tomtom-fuzzy-search",
      expect.objectContaining({
        title: "TomTom Fuzzy Search",
        description: "Typo-tolerant search for addresses, points of interest, and geographies",
        inputSchema: expect.any(Object),
      }),
      expect.any(Function)
    );
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "tomtom-poi-search",
      expect.objectContaining({
        title: "TomTom POI Search",
        description: "Find specific business categories",
        inputSchema: expect.any(Object),
      }),
      expect.any(Function)
    );
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "tomtom-nearby",
      expect.objectContaining({
        title: "TomTom Nearby Search",
        description: "Discover services within a radius",
        inputSchema: expect.any(Object),
      }),
      expect.any(Function)
    );
    expect(mockServer.registerTool).toHaveBeenCalledTimes(5);
  });
});

describe("placeholder", () => {
  it("should have at least one test", () => {
    expect(true).toBe(true);
  });
});
