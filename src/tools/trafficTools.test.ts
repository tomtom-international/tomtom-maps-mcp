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
import { createTrafficTools } from "./trafficTools";

function makeMockServer() {
  return {
    registerTool: vi.fn(),
  };
}

describe("createTrafficTools", () => {
  it("should register the tomtom-traffic tool with the correct schema and handler", () => {
    const mockServer = makeMockServer();
    createTrafficTools(mockServer as any);
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "tomtom-traffic",
      expect.objectContaining({
        title: "TomTom Traffic",
        description: expect.stringContaining("Find and display traffic incidents"),
        inputSchema: expect.any(Object),
      }),
      expect.any(Function)
    );
    expect(mockServer.registerTool).toHaveBeenCalledTimes(1);
  });
});

describe("placeholder", () => {
  it("should have at least one test", () => {
    expect(true).toBe(true);
  });
});
