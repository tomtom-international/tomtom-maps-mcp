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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("./tools/routingTools", () => ({ createRoutingTools: mockCreateRoutingTools }));
vi.mock("./tools/trafficTools", () => ({ createTrafficTools: mockCreateTrafficTools }));
vi.mock("./tools/mapTools", () => ({ createMapTools: mockCreateMapTools }));
vi.mock("./tools/dataVizTools", () => ({ createDataVizTools: mockCreateDataVizTools }));
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

  it("should register every tool group", async () => {
    delete process.env.MAPS;

    const server = await createServer();

    expect(server).toBeDefined();
    expect(mockCreateAppTools).toHaveBeenCalledOnce();
    expect(mockCreateSearchTools).toHaveBeenCalledOnce();
    expect(mockCreateRoutingTools).toHaveBeenCalledOnce();
    expect(mockCreateTrafficTools).toHaveBeenCalledOnce();
    expect(mockCreateMapTools).toHaveBeenCalledOnce();
    expect(mockCreateDataVizTools).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // Backward compatibility: the backend selectors are accepted but inert
  // ---------------------------------------------------------------------------

  it.each(["tomtom-orbis-maps", "tomtom-maps", "TOMTOM-ORBIS-MAPS", "something-invalid"])(
    "should register the same tools when MAPS is %s",
    async (mapsEnv) => {
      process.env.MAPS = mapsEnv;

      await createServer();

      expect(mockCreateSearchTools).toHaveBeenCalledOnce();
      expect(mockCreateDataVizTools).toHaveBeenCalledOnce();
    }
  );

  it.each(["tomtom-orbis-maps", "tomtom-maps"])(
    "should register the same tools when config.mapsBackend is %s",
    async (mapsBackend) => {
      await createServer({ mapsBackend });

      expect(mockCreateSearchTools).toHaveBeenCalledOnce();
      expect(mockCreateDataVizTools).toHaveBeenCalledOnce();
    }
  );

  it("should warn once when a legacy backend selector is supplied", async () => {
    await createServer({ mapsBackend: "tomtom-maps" });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      { maps_backend: "tomtom-maps" },
      "Backend selection is deprecated and ignored — the server always uses the TomTom Maps APIs"
    );
  });

  it("should not warn when no legacy backend selector is supplied", async () => {
    delete process.env.MAPS;

    await createServer();

    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("should not warn for an unrecognised MAPS value", async () => {
    process.env.MAPS = "something-invalid";

    await createServer();

    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // API key validation
  // ---------------------------------------------------------------------------

  it("should validate env-based API key when no config.apiKey is provided", async () => {
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

  // ---------------------------------------------------------------------------
  // Server instance
  // ---------------------------------------------------------------------------

  it("should expose a single server name", () => {
    expect(SERVER_NAME).toBe("TomTom Maps MCP Server");
  });
});
