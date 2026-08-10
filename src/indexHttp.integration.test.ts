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
      _meta?: { visibility?: string[]; ui?: { visibility?: string[] } };
    }>;
  };
}

interface HealthResponse {
  status: string;
  version: string;
}

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

/** Helper to call health endpoint */
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

  // The tomtom-maps-backend header used to select between two backends. It is
  // now inert: any value (including a retired or nonsensical one) must be
  // accepted and yield exactly the same tools as omitting it.
  it.each(["tomtom-orbis-maps", "tomtom-maps", "TomTom-Orbis-Maps", "not-a-backend"])(
    "ignores the deprecated tomtom-maps-backend header when set to %s",
    async (backend) => {
      const baseline = publicToolNames(await listTools(TEST_PORT));
      await delay(100);

      const response = await postMcpListTools({ port: TEST_PORT, backend });
      expect(response.status).toBe(200);
      expect(publicToolNames(parseSSEResponse(await response.text()))).toEqual(baseline);
    }
  );

  it("returns TomTom-Upstream-Metadata response header with base64-encoded auth type for api key", async () => {
    const response = await postMcpListTools({ port: TEST_PORT });
    const header = response.headers.get("tomtom-upstream-metadata");
    expect(header).toBeDefined();
    const decoded = JSON.parse(Buffer.from(header!, "base64").toString());
    expect(decoded).toEqual({ auth_method: "tomtom-api-key" });
  });
});
