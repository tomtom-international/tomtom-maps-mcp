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

const originalEnv = { ...process.env };

// Tool registration is one registry-driven call; `register.test.ts` covers
// what it actually registers.
const mockRegisterTools = vi.fn().mockReturnValue([]);
const mockValidateApiKey = vi.fn();
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock("./tools/register", () => ({ registerTools: mockRegisterTools }));
vi.mock("./services/api-key", () => ({
  requireApiKey: mockValidateApiKey,
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

  it("should register the tool registry against the server it returns", async () => {
    const server = await createServer();

    expect(server).toBeDefined();
    expect(mockRegisterTools).toHaveBeenCalledOnce();
    expect(mockRegisterTools).toHaveBeenCalledWith(server);
  });

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

  it("should warn that MAPS is ignored when it is still set", async () => {
    process.env.MAPS = "tomtom-maps";

    await createServer();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      { MAPS: "tomtom-maps" },
      "MAPS is no longer read; all tools use the TomTom Orbis Maps APIs"
    );
  });

  it("should not warn about MAPS when it is unset", async () => {
    delete process.env.MAPS;

    await createServer();

    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ MAPS: expect.anything() }),
      expect.any(String)
    );
  });

  it("should expose a single server name", () => {
    expect(SERVER_NAME).toBe("TomTom Maps MCP Server");
  });
});
