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

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAxiosGet = vi.fn();
const mockLookup = vi.fn();
const mockStoreVizData = vi.fn();
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock("axios", () => ({
  default: { get: mockAxiosGet },
}));

vi.mock("node:dns/promises", () => ({
  lookup: mockLookup,
}));

vi.mock("../services/cache/vizCache", () => ({
  storeVizData: mockStoreVizData,
}));

vi.mock("../utils/logger", () => ({
  logger: mockLogger,
}));

// Import after mocking
const { createDataVizHandler } = await import("./dataVizOrbisHandler");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_GEOJSON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [4.89, 52.37] },
      properties: { name: "Amsterdam" },
    },
  ],
};

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    layers: [{ type: "markers" }],
    ...overrides,
  };
}

function mockPublicDns(ip = "93.184.216.34") {
  mockLookup.mockResolvedValue({ address: ip, family: 4 });
}

function mockAxiosSuccess(data: unknown = VALID_GEOJSON) {
  mockAxiosGet.mockResolvedValue({ data });
}

function parseResult(result: { content: { text: string }[] }) {
  return JSON.parse(result.content[0].text);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dataVizHandler SSRF protection", () => {
  let handler: ReturnType<typeof createDataVizHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreVizData.mockResolvedValue("test-viz-id");
    handler = createDataVizHandler();
  });

  // -------------------------------------------------------------------------
  // Scheme validation
  // -------------------------------------------------------------------------

  describe("scheme validation", () => {
    it("should reject http URLs", async () => {
      const result = await handler(baseParams({ data_url: "http://example.com/data.geojson" }));
      const parsed = parseResult(result);
      expect(result.isError).toBe(true);
      expect(parsed.error).toContain("Only https URLs are allowed");
    });

    it("should reject ftp URLs", async () => {
      const result = await handler(baseParams({ data_url: "ftp://example.com/data.geojson" }));
      const parsed = parseResult(result);
      expect(result.isError).toBe(true);
      expect(parsed.error).toContain("Only https URLs are allowed");
    });

    it("should reject file URLs", async () => {
      const result = await handler(baseParams({ data_url: "file:///etc/passwd" }));
      const parsed = parseResult(result);
      expect(result.isError).toBe(true);
      expect(parsed.error).toContain("Only https URLs are allowed");
    });

    it("should reject invalid URL format", async () => {
      const result = await handler(baseParams({ data_url: "not-a-url" }));
      const parsed = parseResult(result);
      expect(result.isError).toBe(true);
      expect(parsed.error).toContain("Invalid URL format");
    });
  });

  // -------------------------------------------------------------------------
  // Credential stripping
  // -------------------------------------------------------------------------

  describe("credential validation", () => {
    it("should reject URLs with username", async () => {
      const result = await handler(
        baseParams({ data_url: "https://user@example.com/data.geojson" })
      );
      const parsed = parseResult(result);
      expect(result.isError).toBe(true);
      expect(parsed.error).toContain("URLs with credentials are not allowed");
    });

    it("should reject URLs with username and password", async () => {
      const result = await handler(
        baseParams({ data_url: "https://user:pass@example.com/data.geojson" })
      );
      const parsed = parseResult(result);
      expect(result.isError).toBe(true);
      expect(parsed.error).toContain("URLs with credentials are not allowed");
    });
  });

  // -------------------------------------------------------------------------
  // Private/reserved IP blocking
  // -------------------------------------------------------------------------

  describe("private IP blocking", () => {
    it.each([
      ["loopback", "127.0.0.1"],
      ["private 10.x", "10.0.0.1"],
      ["private 172.16.x", "172.16.0.1"],
      ["private 192.168.x", "192.168.1.1"],
      ["link-local / cloud metadata", "169.254.169.254"],
    ])("should block %s (%s)", async (_label, ip) => {
      mockLookup.mockResolvedValue({ address: ip, family: 4 });
      const result = await handler(
        baseParams({ data_url: "https://evil.com/data.geojson" })
      );
      const parsed = parseResult(result);
      expect(result.isError).toBe(true);
      expect(parsed.error).toContain("URL resolves to a non-public IP address");
    });

    it("should block IP literal in URL (loopback)", async () => {
      const result = await handler(
        baseParams({ data_url: "https://127.0.0.1/data.geojson" })
      );
      const parsed = parseResult(result);
      expect(result.isError).toBe(true);
      expect(parsed.error).toContain("URL resolves to a non-public IP address");
    });

    it("should block IP literal in URL (private)", async () => {
      const result = await handler(
        baseParams({ data_url: "https://10.0.0.1/data.geojson" })
      );
      const parsed = parseResult(result);
      expect(result.isError).toBe(true);
      expect(parsed.error).toContain("URL resolves to a non-public IP address");
    });

    it("should log blocked requests with details", async () => {
      mockLookup.mockResolvedValue({ address: "169.254.169.254", family: 4 });
      await handler(baseParams({ data_url: "https://metadata.example.com/creds" }));
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: "metadata.example.com",
          resolvedIp: "169.254.169.254",
          range: "linkLocal",
        }),
        "Blocked non-public URL"
      );
    });
  });

  // -------------------------------------------------------------------------
  // IPv6 blocking
  // -------------------------------------------------------------------------

  describe("IPv6 blocking", () => {
    it("should block IPv6 loopback", async () => {
      mockLookup.mockResolvedValue({ address: "::1", family: 6 });
      const result = await handler(
        baseParams({ data_url: "https://evil.com/data.geojson" })
      );
      const parsed = parseResult(result);
      expect(result.isError).toBe(true);
      expect(parsed.error).toContain("URL resolves to a non-public IP address");
    });

    it("should block IPv6 link-local", async () => {
      mockLookup.mockResolvedValue({ address: "fe80::1", family: 6 });
      const result = await handler(
        baseParams({ data_url: "https://evil.com/data.geojson" })
      );
      const parsed = parseResult(result);
      expect(result.isError).toBe(true);
      expect(parsed.error).toContain("URL resolves to a non-public IP address");
    });

    it("should block IPv6 unique local", async () => {
      mockLookup.mockResolvedValue({ address: "fd12::1", family: 6 });
      const result = await handler(
        baseParams({ data_url: "https://evil.com/data.geojson" })
      );
      const parsed = parseResult(result);
      expect(result.isError).toBe(true);
      expect(parsed.error).toContain("URL resolves to a non-public IP address");
    });
  });

  // -------------------------------------------------------------------------
  // Valid public URL (happy path)
  // -------------------------------------------------------------------------

  describe("valid public URL", () => {
    it("should allow https URL resolving to public IP", async () => {
      mockPublicDns();
      mockAxiosSuccess();
      const result = await handler(
        baseParams({ data_url: "https://example.com/data.geojson" })
      );
      expect(result.isError).toBeUndefined();
      const parsed = parseResult(result);
      expect(parsed.summary.feature_count).toBe(1);
      expect(parsed._meta.viz_id).toBe("test-viz-id");
    });

    it("should pass httpsAgent to axios for DNS pinning", async () => {
      mockPublicDns();
      mockAxiosSuccess();
      await handler(baseParams({ data_url: "https://example.com/data.geojson" }));
      expect(mockAxiosGet).toHaveBeenCalledWith(
        "https://example.com/data.geojson",
        expect.objectContaining({
          httpsAgent: expect.any(Object),
          maxRedirects: 0,
        })
      );
    });

    it("should set maxRedirects to 0", async () => {
      mockPublicDns();
      mockAxiosSuccess();
      await handler(baseParams({ data_url: "https://example.com/data.geojson" }));
      expect(mockAxiosGet).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ maxRedirects: 0 })
      );
    });
  });

  // -------------------------------------------------------------------------
  // Inline GeoJSON (not affected by SSRF, but ensure no regression)
  // -------------------------------------------------------------------------

  describe("inline geojson (no SSRF path)", () => {
    it("should still work with inline geojson", async () => {
      mockStoreVizData.mockResolvedValue("inline-viz-id");
      const result = await handler(
        baseParams({ geojson: JSON.stringify(VALID_GEOJSON) })
      );
      expect(result.isError).toBeUndefined();
      expect(mockAxiosGet).not.toHaveBeenCalled();
      expect(mockLookup).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // DNS failure
  // -------------------------------------------------------------------------

  describe("DNS failure", () => {
    it("should return error when DNS resolution fails", async () => {
      mockLookup.mockRejectedValue(new Error("ENOTFOUND"));
      const result = await handler(
        baseParams({ data_url: "https://nonexistent.invalid/data.geojson" })
      );
      expect(result.isError).toBe(true);
    });
  });
});
