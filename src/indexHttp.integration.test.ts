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

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ENDPOINT_HEALTH, ENDPOINT_MCP } from "./constants";
import { createHttpServer, type HttpServerResult } from "./indexHttp";
import { logger } from "./utils/logger";

/** An app template the size of a real one: the built apps are not there under test. */
const APP_HTML = `<!DOCTYPE html><html><body>${"<div>map</div>".repeat(50_000)}</body></html>`;

vi.mock("./tools/helpers/appHtmlCache", () => ({ readAppHtml: async () => APP_HTML }));

/** Small delay to ensure SSE responses complete before shutdown */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const TEST_API_KEY = "test-api-key";

interface ToolsListResponse {
  jsonrpc: string;
  id: number;
  result?: {
    tools: Array<{
      name: string;
      _meta?: { visibility?: string[]; ui?: { visibility?: string[] } };
    }>;
  };
}

interface HealthResponse {
  status: string;
  version: string;
}

function parseSSEResponse<T>(text: string): T {
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) {
    throw new Error(`No data line in SSE response: ${text}`);
  }
  return JSON.parse(dataLine.slice(6));
}

async function postMcpListTools({
  port,
  extraHeaders = {},
}: {
  port: number;
  extraHeaders?: Record<string, string>;
}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json,text/event-stream",
    Connection: "close",
    "tomtom-api-key": TEST_API_KEY,
    ...extraHeaders,
  };

  return await fetch(`http://localhost:${port}/${ENDPOINT_MCP}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
}

async function postMcp(
  port: number,
  method: string,
  params: Record<string, unknown>,
  acceptEncoding: string
) {
  return await fetch(`http://localhost:${port}/${ENDPOINT_MCP}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json,text/event-stream",
      "Accept-Encoding": acceptEncoding,
      Connection: "close",
      "tomtom-api-key": TEST_API_KEY,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function listTools(port: number): Promise<ToolsListResponse> {
  const response = await postMcpListTools({ port });
  return parseSSEResponse(await response.text());
}

async function getHealth(port: number): Promise<HealthResponse> {
  const response = await fetch(`http://localhost:${port}/${ENDPOINT_HEALTH}`);
  return response.json();
}

/** Sorted tool names, excluding app-internal tools (those with visibility: ["app"]) */
function publicToolNames(result: ToolsListResponse): string[] {
  expect(result.result?.tools).toBeDefined();
  return result
    .result!.tools.filter(
      (tool) =>
        !tool._meta?.visibility?.includes("app") && !tool._meta?.ui?.visibility?.includes("app")
    )
    .map((tool) => tool.name)
    .sort();
}

describe("HTTP Server Integration", () => {
  let serverResult: HttpServerResult;
  const TEST_PORT = 3998;

  beforeAll(async () => {
    serverResult = await createHttpServer({ port: TEST_PORT });
  });

  afterAll(async () => {
    // Small delay to ensure SSE responses complete before shutdown
    await delay(50);
    await serverResult.shutdown();
  });

  // Small delay between tests to prevent SSE stream overlap issues
  beforeEach(async () => {
    await delay(100);
  });

  it("health endpoint reports status and version", async () => {
    const health = await getHealth(TEST_PORT);

    expect(health.status).toBe("ok");
    expect(health.version).toBeTruthy();
  });

  it("serves a non-empty tool list", async () => {
    expect(publicToolNames(await listTools(TEST_PORT)).length).toBeGreaterThan(0);
  });

  it("returns TomTom-Upstream-Metadata response header with base64-encoded auth type for api key", async () => {
    const response = await postMcpListTools({ port: TEST_PORT });
    const header = response.headers.get("tomtom-upstream-metadata");
    expect(header).toBeDefined();
    const decoded = JSON.parse(Buffer.from(header!, "base64").toString());
    expect(decoded).toEqual({ auth_method: "tomtom-api-key" });
  });

  it("warns that the tomtom-maps-backend header is ignored", async () => {
    const warn = vi.spyOn(logger, "warn");

    const response = await postMcpListTools({
      port: TEST_PORT,
      extraHeaders: { "tomtom-maps-backend": "tomtom-maps" },
    });
    await response.text();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ "tomtom-maps-backend": "tomtom-maps" }),
      "The tomtom-maps-backend header is no longer read; all tools use the TomTom Orbis Maps APIs"
    );
    warn.mockRestore();
  });

  describe("compression", () => {
    const APP_URI = "ui://tomtom-search/geocode/app.html";

    it("gzips app templates for a client that accepts gzip", async () => {
      const response = await postMcp(TEST_PORT, "resources/read", { uri: APP_URI }, "gzip");

      expect(response.headers.get("content-encoding")).toBe("gzip");
      expect(response.headers.get("content-type")).toContain("application/json");
      const body = (await response.json()) as { result: { contents: Array<{ text: string }> } };
      expect(body.result.contents[0].text).toBe(APP_HTML);
    });

    it("sends app templates uncompressed to a client that does not accept gzip", async () => {
      const response = await postMcp(TEST_PORT, "resources/read", { uri: APP_URI }, "identity");
      await response.text();

      expect(response.headers.get("content-encoding")).toBeNull();
    });

    it("never compresses other methods, whose results can hold secrets", async () => {
      const response = await postMcp(TEST_PORT, "tools/list", {}, "gzip");
      await response.text();

      expect(response.headers.get("content-encoding")).toBeNull();
    });
  });
});
