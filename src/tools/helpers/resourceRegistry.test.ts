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

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const mockReadFile = vi.fn();

// Capture the resource handler passed to registerAppResource
type ResourceResult = {
  contents: { uri: string; mimeType: string; text: string; _meta?: Record<string, unknown> }[];
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let capturedResourceHandler: ((...args: any[]) => Promise<ResourceResult>) | null = null;
const mockRegisterAppResource = vi.fn(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (
    _server: unknown,
    _uri: string,
    _name: string,
    _opts: unknown,
    handler: (...args: any[]) => Promise<ResourceResult>
  ) => {
    capturedResourceHandler = handler;
  }
);

vi.mock("node:fs/promises", () => ({
  default: { readFile: mockReadFile },
}));

vi.mock("@modelcontextprotocol/ext-apps/server", () => ({
  registerAppResource: mockRegisterAppResource,
  RESOURCE_MIME_TYPE: "text/html",
}));

const { registerAppResourceFromPath } = await import("./resourceRegistry");

describe("registerAppResourceFromPath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedResourceHandler = null;
  });

  it("should register a resource and serve HTML content on read", async () => {
    const mockServer = {} as McpServer;
    const resourceUri = "ui://test/app.html";

    await registerAppResourceFromPath(mockServer, resourceUri, "search", "geocode");

    expect(mockRegisterAppResource).toHaveBeenCalledOnce();
    expect(capturedResourceHandler).toBeDefined();

    // Simulate reading the resource
    mockReadFile.mockResolvedValue("<html><body>Test App</body></html>");
    const result = await capturedResourceHandler!();

    expect(result.contents[0].uri).toBe(resourceUri);
    expect(result.contents[0].mimeType).toBe("text/html");
    expect(result.contents[0].text).toBe("<html><body>Test App</body></html>");
    const meta = result.contents[0]._meta as { ui: { csp: { connectDomains: string[] } } };
    expect(meta.ui.csp.connectDomains).toContain("https://api.tomtom.com");
  });

  it("should return fallback HTML when file read fails", async () => {
    const mockServer = {} as McpServer;
    const resourceUri = "ui://test/app.html";

    await registerAppResourceFromPath(mockServer, resourceUri, "search", "geocode");

    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const result = await capturedResourceHandler!();

    expect(result.contents[0].text).toContain("App not found");
    expect(result.contents[0].text).toContain("npm run build:apps");
  });
});
