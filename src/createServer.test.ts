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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Save original env
const originalEnv = { ...process.env };

// Create mocks for all tool creators
const mockCreateAppTools = vi.fn();
const mockCreateSearchTools = vi.fn().mockResolvedValue(undefined);
const mockCreateRoutingTools = vi.fn().mockResolvedValue(undefined);
const mockCreateTrafficTools = vi.fn().mockResolvedValue(undefined);
const mockCreateMapTools = vi.fn().mockResolvedValue(undefined);
const mockCreateDataVizTools = vi.fn().mockResolvedValue(undefined);
const mockValidateApiKey = vi.fn();
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock("./tools/appTools", () => ({ createAppTools: mockCreateAppTools }));
vi.mock("./tools/searchTools", () => ({ createSearchTools: mockCreateSearchTools }));
vi.mock("./tools/routingTools", () => ({
  createRoutingTools: mockCreateRoutingTools,
}));
vi.mock("./tools/trafficTools", () => ({
  createTrafficTools: mockCreateTrafficTools,
}));
vi.mock("./tools/mapTools", () => ({ createMapTools: mockCreateMapTools }));
vi.mock("./tools/dataVizTools", () => ({
  createDataVizTools: mockCreateDataVizTools,
}));
vi.mock("./services/base/tomtomClient", () => ({
  validateApiKey: mockValidateApiKey,
  isHttpMode: false,
}));
vi.mock("./utils/logger", () => ({ logger: mockLogger }));
vi.mock("./version", () => ({ VERSION: "1.0.0-test" }));

const { createServer, SERVER_NAME } = await import("./createServer");

describe("createServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ---------------------------------------------------------------------------
  // Tool registration
  // ---------------------------------------------------------------------------

  it("should register the app tools and every tool set", async () => {
    const server = await createServer();

    expect(server).toBeDefined();
    expect(mockCreateAppTools).toHaveBeenCalledOnce();
    expect(mockCreateSearchTools).toHaveBeenCalledOnce();
    expect(mockCreateRoutingTools).toHaveBeenCalledOnce();
    expect(mockCreateTrafficTools).toHaveBeenCalledOnce();
    expect(mockCreateMapTools).toHaveBeenCalledOnce();
    expect(mockCreateDataVizTools).toHaveBeenCalledOnce();
  });

  it("should report the TomTom Maps server name", async () => {
    const server = await createServer();

    expect(SERVER_NAME).toBe("TomTom Maps MCP Server");
    expect(mockLogger.debug).toHaveBeenCalledWith(
      { server_name: SERVER_NAME },
      "Initializing MCP server"
    );
    expect(server).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // API key validation
  // ---------------------------------------------------------------------------

  it("should validate the environment API key outside HTTP mode", async () => {
    await createServer();

    expect(mockValidateApiKey).toHaveBeenCalledOnce();
  });

  it("should not throw when env-based API key validation fails", async () => {
    mockValidateApiKey.mockImplementation(() => {
      throw new Error("TOMTOM_API_KEY is not set");
    });

    // Should not reject — server starts but warns
    const server = await createServer();

    expect(server).toBeDefined();
    expect(mockLogger.error).toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Server will start but API calls may fail without valid credentials"
    );
  });
});
