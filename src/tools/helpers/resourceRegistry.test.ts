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

const mockReadFile = vi.fn();
const mockStat = vi.fn();

// Capture the resource handler passed to registerAppResource
type ResourceResult = {
  contents: { uri: string; mimeType: string; text: string; _meta?: Record<string, unknown> }[];
};
let capturedResourceHandler: ((...args: any[]) => Promise<ResourceResult>) | null = null;
const mockRegisterAppResource = vi.fn(
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
  default: { readFile: mockReadFile, stat: mockStat },
}));

vi.mock("@modelcontextprotocol/ext-apps/server", () => ({
  registerAppResource: mockRegisterAppResource,
  RESOURCE_MIME_TYPE: "text/html",
}));

const { registerAppResourceFromPath } = await import("./resourceRegistry");
const { FaultError } = await import("../../types/types");

describe("registerAppResourceFromPath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedResourceHandler = null;
    // The handler reads through appHtmlCache, which stats before reading.
    mockStat.mockResolvedValue({ mtimeMs: 1000, size: 42 });
  });

  // appHtmlCache is keyed by file path and outlives a single test, so each test
  // uses its own app name. Sharing one would let the first test's cached HTML
  // satisfy the second, which then could not reach the failure path at all.

  it("should register a resource and serve HTML content on read", async () => {
    const mockServer = {} as McpServer;
    const resourceUri = "ui://test/app.html";

    await registerAppResourceFromPath(mockServer, resourceUri, "search", "serves-html");

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

  it("fails the read with a fault naming the app, never the server's file path, when the bundle cannot be read", async () => {
    const mockServer = {} as McpServer;
    const resourceUri = "ui://test/app.html";
    const readError = new Error("ENOENT");

    await registerAppResourceFromPath(mockServer, resourceUri, "search", "read-fails");

    mockReadFile.mockRejectedValue(readError);
    const failure = await capturedResourceHandler!().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(FaultError);
    const fault = failure as InstanceType<typeof FaultError>;
    expect(fault.message).toBe(
      "The app could not be loaded on this server: its operator must rebuild the apps."
    );
    expect(fault.data).toEqual({ resourceUri });
    expect(fault.cause).toBe(readError);
  });
});
