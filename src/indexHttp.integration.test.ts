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

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ENDPOINT_HEALTH, ENDPOINT_MCP } from "./constants";
import { createHttpServer, type HttpServerResult } from "./indexHttp";

/** Small delay to ensure SSE responses complete before shutdown */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const TEST_API_KEY = "test-api-key";

interface ToolsListResponse {
  jsonrpc: string;
  id: number;
  result?: {
    tools: Array<{
      name: string;
      _meta?: { backend?: string; visibility?: string[]; ui?: { visibility?: string[] } };
    }>;
  };
}

const PUBLIC_TOOLS = [
  "tomtom-area-search",
  "tomtom-data-viz",
  "tomtom-dynamic-map",
  "tomtom-ev-routing",
  "tomtom-ev-search",
  "tomtom-fuzzy-search",
  "tomtom-geocode",
  "tomtom-nearby",
  "tomtom-poi-categories",
  "tomtom-poi-search",
  "tomtom-reachable-range",
  "tomtom-reverse-geocode",
  "tomtom-routing",
  "tomtom-search-along-route",
  "tomtom-traffic",
];

const APP_TOOLS = ["tomtom-get-api-key", "tomtom-get-app-config", "tomtom-get-viz-data"];

/** Helper to parse SSE response */
function parseSSEResponse<T>(text: string): T {
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) {
    throw new Error(`No data line in SSE response: ${text}`);
  }
  return JSON.parse(dataLine.slice(6));
}

async function postMcpListTools({ port, backend }: { port: number; backend?: string }) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json,text/event-stream",
    Connection: "close",
    "tomtom-api-key": TEST_API_KEY,
  };
  if (backend != null) {
    headers["tomtom-maps-backend"] = backend;
  }

  return await fetch(`http://localhost:${port}/${ENDPOINT_MCP}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
}

/** Helper to call tools/list endpoint */
async function listTools(port: number, backend?: string): Promise<ToolsListResponse> {
  const response = await postMcpListTools({ port, backend });
  return parseSSEResponse(await response.text());
}

function isAppTool(tool: NonNullable<ToolsListResponse["result"]>["tools"][number]): boolean {
  return !!(tool._meta?.visibility?.includes("app") || tool._meta?.ui?.visibility?.includes("app"));
}

function toolNames(result: ToolsListResponse): { publicTools: string[]; appTools: string[] } {
  const tools = result.result?.tools ?? [];
  return {
    publicTools: tools
      .filter((tool) => !isAppTool(tool))
      .map((tool) => tool.name)
      .sort(),
    appTools: tools
      .filter(isAppTool)
      .map((tool) => tool.name)
      .sort(),
  };
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

  it("health endpoint reports status and version only", async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/${ENDPOINT_HEALTH}`);
    const health = await response.json();

    expect(health).toEqual({ status: "ok", version: expect.any(String) });
  });

  it("lists every public and app tool", async () => {
    const { publicTools, appTools } = toolNames(await listTools(TEST_PORT));

    expect(publicTools).toEqual(PUBLIC_TOOLS);
    expect(appTools).toEqual(APP_TOOLS);
  });

  it.each(["tomtom-maps", "tomtom-orbis-maps", "not-a-backend"])(
    "ignores the deprecated tomtom-maps-backend header (%s)",
    async (backend) => {
      const response = await postMcpListTools({ port: TEST_PORT, backend });

      expect(response.status).toBe(200);
      expect(toolNames(parseSSEResponse(await response.text())).publicTools).toEqual(PUBLIC_TOOLS);
    }
  );

  it("still allows the deprecated tomtom-maps-backend header in CORS preflight", async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/${ENDPOINT_MCP}`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://client.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,tomtom-api-key,tomtom-maps-backend",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")?.toLowerCase()).toContain(
      "tomtom-maps-backend"
    );
  });

  it("returns TomTom-Upstream-Metadata response header with base64-encoded auth type for api key", async () => {
    const response = await postMcpListTools({ port: TEST_PORT });
    const header = response.headers.get("tomtom-upstream-metadata");
    expect(header).toBeDefined();
    const decoded = JSON.parse(Buffer.from(header!, "base64").toString());
    expect(decoded).toEqual({ auth_method: "tomtom-api-key" });
  });
});
