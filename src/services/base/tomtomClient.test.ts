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

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";

// Save original environment before anything else
const originalEnv = { ...process.env };

// Set environment variables
process.env.TOMTOM_API_KEY = "test-api-key";

// Mock axios BEFORE importing the module that uses it
vi.mock("axios", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const mockAxiosGet = vi.fn();
  const mockAxiosCreate = vi.fn().mockReturnValue({
    get: mockAxiosGet,
    post: vi.fn(),
    defaults: {
      baseURL: "https://api.tomtom.com",
      params: { key: "test-api-key" },
    },
  });
  return {
    ...actual,
    create: mockAxiosCreate,
    isAxiosError: vi.fn(),
  };
});

// Now import the module under test
import { validateApiKey, API_VERSION, isHttpMode, setHttpMode, tomtomClient } from "./tomtomClient";

describe("TomTom Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Reset environment after each test
    process.env = { ...originalEnv };
    process.env.TOMTOM_API_KEY = "test-api-key"; // Restore for most tests
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  it("should validate API key successfully when key exists", () => {
    // No need to expect anything specific - validateApiKey doesn't return a value
    // As long as it doesn't throw, the test passes
    expect(() => validateApiKey()).not.toThrow();
  });

  it("should export correct API version constants", () => {
    expect({
      SEARCH: API_VERSION.SEARCH,
      GEOCODING: API_VERSION.GEOCODING,
      ROUTING: API_VERSION.ROUTING,
      TRAFFIC: API_VERSION.TRAFFIC,
      MAP: API_VERSION.MAP,
    }).toEqual({
      SEARCH: 2,
      GEOCODING: 2,
      ROUTING: 1,
      TRAFFIC: 5,
      MAP: 1,
    });
  });
  
  it("should use different User-Agent headers based on mode", () => {
    // Default mode (stdio)
    expect(isHttpMode).toBe(false);
    expect(tomtomClient.defaults.headers["TomTom-User-Agent"]).toContain("TomTomMCPSDK/");
    
    // Set HTTP mode (default HTTP type)
    setHttpMode();
    expect(isHttpMode).toBe(true);
    expect(tomtomClient.defaults.headers["TomTom-User-Agent"]).toContain("TomTomMCPSDKHttp/");
  });
  
  it("should use custom MCP_TRANSPORT_MODE from environment variable when available", () => {
    // Set custom MCP_TRANSPORT_MODE in environment
    process.env.MCP_TRANSPORT_MODE = "CustomMCPType";
    
    // Set HTTP mode with custom type
    setHttpMode();
    expect(isHttpMode).toBe(true);
    expect(tomtomClient.defaults.headers["TomTom-User-Agent"]).toContain("CustomMCPType/");
    
    // Clean up
    delete process.env.MCP_TRANSPORT_MODE;
  });
  
  it("should use default type when MCP_TRANSPORT_MODE is empty", () => {
    // Set empty MCP_TRANSPORT_MODE in environment
    process.env.MCP_TRANSPORT_MODE = '';
    
    // Set HTTP mode with empty type - should use default
    setHttpMode();
    expect(isHttpMode).toBe(true);
    expect(tomtomClient.defaults.headers["TomTom-User-Agent"]).toContain("TomTomMCPSDKHttp/");
    
    // Clean up
    delete process.env.MCP_TRANSPORT_MODE;
  });
  
  it("should use default type when MCP_TRANSPORT_MODE is not set", () => {
    // Ensure MCP_TRANSPORT_MODE doesn't exist in environment
    delete process.env.MCP_TRANSPORT_MODE;
    
    // Set HTTP mode with non-existent env variable - should use default
    setHttpMode();
    expect(isHttpMode).toBe(true);
    expect(tomtomClient.defaults.headers["TomTom-User-Agent"]).toContain("TomTomMCPSDKHttp/");
  });
});
