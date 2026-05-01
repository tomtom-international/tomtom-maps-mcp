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
const mockCreateSearchTools = vi.fn();
const mockCreateRoutingTools = vi.fn();
const mockCreateTrafficTools = vi.fn();
const mockCreateMapTools = vi.fn();
const mockCreateSearchOrbisTools = vi.fn().mockResolvedValue(undefined);
const mockCreateRoutingOrbisTools = vi.fn().mockResolvedValue(undefined);
const mockCreateTrafficOrbisTools = vi.fn().mockResolvedValue(undefined);
const mockCreateMapOrbisTools = vi.fn().mockResolvedValue(undefined);
const mockCreateDataVizOrbisTools = vi.fn().mockResolvedValue(undefined);
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
vi.mock("./tools/searchOrbisTools", () => ({ createSearchOrbisTools: mockCreateSearchOrbisTools }));
vi.mock("./tools/routingOrbisTools", () => ({
  createRoutingOrbisTools: mockCreateRoutingOrbisTools,
}));
vi.mock("./tools/trafficOrbisTools", () => ({
  createTrafficOrbisTools: mockCreateTrafficOrbisTools,
}));
vi.mock("./tools/mapOrbisTools", () => ({ createMapOrbisTools: mockCreateMapOrbisTools }));
vi.mock("./tools/dataVizOrbisTools", () => ({
  createDataVizOrbisTools: mockCreateDataVizOrbisTools,
}));
vi.mock("./services/base/tomtomClient", () => ({ validateApiKey: mockValidateApiKey, isHttpMode: false }));
vi.mock("./utils/logger", () => ({ logger: mockLogger }));
vi.mock("./version", () => ({ VERSION: "1.0.0-test" }));

const { createServer } = await import("./createServer");

describe("createServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ---------------------------------------------------------------------------
  // Backend selection
  // ---------------------------------------------------------------------------

  it("should register standard tools when no config is provided and MAPS env is not set", async () => {
    delete process.env.MAPS;

    const server = await createServer();

    expect(server).toBeDefined();
    expect(mockCreateAppTools).toHaveBeenCalledOnce();
    expect(mockCreateSearchTools).toHaveBeenCalledOnce();
    expect(mockCreateRoutingTools).toHaveBeenCalledOnce();
    expect(mockCreateTrafficTools).toHaveBeenCalledOnce();
    expect(mockCreateMapTools).toHaveBeenCalledOnce();
    // Orbis tools should NOT be called
    expect(mockCreateSearchOrbisTools).not.toHaveBeenCalled();
    expect(mockCreateRoutingOrbisTools).not.toHaveBeenCalled();
    expect(mockCreateDataVizOrbisTools).not.toHaveBeenCalled();
  });

  it("should register Orbis tools when MAPS env is tomtom-orbis-maps", async () => {
    process.env.MAPS = "tomtom-orbis-maps";

    await createServer();

    expect(mockCreateAppTools).toHaveBeenCalledOnce();
    expect(mockCreateSearchOrbisTools).toHaveBeenCalledOnce();
    expect(mockCreateRoutingOrbisTools).toHaveBeenCalledOnce();
    expect(mockCreateTrafficOrbisTools).toHaveBeenCalledOnce();
    expect(mockCreateMapOrbisTools).toHaveBeenCalledOnce();
    expect(mockCreateDataVizOrbisTools).toHaveBeenCalledOnce();
    // Standard tools should NOT be called
    expect(mockCreateSearchTools).not.toHaveBeenCalled();
    expect(mockCreateRoutingTools).not.toHaveBeenCalled();
  });

  it("should register Orbis tools when config.mapsBackend is tomtom-orbis-maps", async () => {
    await createServer({ mapsBackend: "tomtom-orbis-maps" });

    expect(mockCreateSearchOrbisTools).toHaveBeenCalledOnce();
    expect(mockCreateDataVizOrbisTools).toHaveBeenCalledOnce();
    expect(mockCreateSearchTools).not.toHaveBeenCalled();
  });

  it("should register standard tools when config.mapsBackend is tomtom-maps", async () => {
    await createServer({ mapsBackend: "tomtom-maps" });

    expect(mockCreateSearchTools).toHaveBeenCalledOnce();
    expect(mockCreateSearchOrbisTools).not.toHaveBeenCalled();
  });

  it("should be case-insensitive for MAPS env var", async () => {
    process.env.MAPS = "TOMTOM-ORBIS-MAPS";

    await createServer();

    expect(mockCreateSearchOrbisTools).toHaveBeenCalledOnce();
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

  it("should always register appTools regardless of backend", async () => {
    await createServer({ mapsBackend: "tomtom-maps" });
    expect(mockCreateAppTools).toHaveBeenCalledOnce();

    vi.clearAllMocks();

    await createServer({ mapsBackend: "tomtom-orbis-maps" });
    expect(mockCreateAppTools).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // Config vs environment precedence
  // ---------------------------------------------------------------------------

  it("should use config.mapsBackend over MAPS env var", async () => {
    // Env says Orbis, but config says standard — config should win
    process.env.MAPS = "tomtom-orbis-maps";

    await createServer({ mapsBackend: "tomtom-maps" });

    expect(mockCreateSearchTools).toHaveBeenCalledOnce();
    expect(mockCreateSearchOrbisTools).not.toHaveBeenCalled();
  });

  it("should register standard tools for unrecognized MAPS env value", async () => {
    process.env.MAPS = "something-invalid";

    await createServer();

    // isOrbis is false for any non-matching value
    expect(mockCreateSearchTools).toHaveBeenCalledOnce();
    expect(mockCreateSearchOrbisTools).not.toHaveBeenCalled();
  });
});
