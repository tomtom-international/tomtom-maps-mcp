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

interface HealthResponse {
  status: string;
  version: string;
  mode: string;
  backends: string[];
  default?: string;
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

/** Helper to assert all tools target a specific backend (excluding app-internal tools) */
function expectToolsToTargetBackend(result: ToolsListResponse, backend: string): void {
  expect(result.result?.tools).toBeDefined();
  expect(result.result!.tools.length).toBeGreaterThan(0);
  // Filter out app-internal tools (those with visibility: ["app"])
  const backendTools = result.result!.tools.filter(
    (tool) =>
      !tool._meta?.visibility?.includes("app") && !tool._meta?.ui?.visibility?.includes("app")
  );
  expect(backendTools.length).toBeGreaterThan(0);
  for (const tool of backendTools) {
    expect(tool._meta?.backend).toBe(backend);
  }
}

describe("HTTP Server Integration - Dual Backend Mode", () => {
  let serverResult: HttpServerResult;
  const TEST_PORT = 3998;

  beforeAll(async () => {
    serverResult = await createHttpServer({
      port: TEST_PORT,
      fixedBackend: null, // Dual mode
      defaultBackend: "tomtom-maps",
    });
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

  it("health endpoint returns dual mode with both backends", async () => {
    const health = await getHealth(TEST_PORT);

    expect(health.status).toBe("ok");
    expect(health.mode).toBe("dual");
    expect(health.backends).toContain("tomtom-maps");
    expect(health.backends).toContain("tomtom-orbis-maps");
    expect(health.default).toBe("tomtom-maps");
  });

  it("returns tomtom-maps tools with _meta.backend='tomtom-maps' when header is 'tomtom-maps'", async () => {
    const result = await listTools(TEST_PORT, "tomtom-maps");
    expectToolsToTargetBackend(result, "tomtom-maps");
  });

  it("returns tomtom-orbis-maps tools with _meta.backend='tomtom-orbis-maps' when header is 'tomtom-orbis-maps'", async () => {
    const result = await listTools(TEST_PORT, "tomtom-orbis-maps");
    expectToolsToTargetBackend(result, "tomtom-orbis-maps");
  });

  it("defaults to tomtom-maps when no header is provided", async () => {
    const result = await listTools(TEST_PORT);
    expectToolsToTargetBackend(result, "tomtom-maps");
  });
});

describe("HTTP Server Integration - Fixed Backend Mode (TomTom Orbis Maps)", () => {
  let serverResult: HttpServerResult;
  const TEST_PORT = 3997;

  beforeAll(async () => {
    serverResult = await createHttpServer({
      port: TEST_PORT,
      fixedBackend: "tomtom-orbis-maps",
    });
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

  it("health endpoint returns fixed mode with tomtom-orbis-maps backend", async () => {
    const health = await getHealth(TEST_PORT);

    expect(health.status).toBe("ok");
    expect(health.mode).toBe("fixed");
    expect(health.backends).toEqual(["tomtom-orbis-maps"]);
    expect(health.default).toBeUndefined();
  });

  it("always returns tomtom-orbis-maps tools even when header requests tomtom-maps", async () => {
    const result = await listTools(TEST_PORT, "tomtom-maps");
    expectToolsToTargetBackend(result, "tomtom-orbis-maps");
  });

  it("returns tomtom-orbis-maps tools when no header is provided", async () => {
    const result = await listTools(TEST_PORT);
    expectToolsToTargetBackend(result, "tomtom-orbis-maps");
  });
});

describe("HTTP Server Integration - Fixed Backend Mode (TomTom Maps)", () => {
  let serverResult: HttpServerResult;
  const TEST_PORT = 3996;

  beforeAll(async () => {
    serverResult = await createHttpServer({
      port: TEST_PORT,
      fixedBackend: "tomtom-maps",
    });
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

  it("health endpoint returns fixed mode with tomtom-maps backend", async () => {
    const health = await getHealth(TEST_PORT);

    expect(health.status).toBe("ok");
    expect(health.mode).toBe("fixed");
    expect(health.backends).toEqual(["tomtom-maps"]);
    expect(health.default).toBeUndefined();
  });

  it("always returns tomtom-maps tools even when header requests tomtom-orbis-maps", async () => {
    const result = await listTools(TEST_PORT, "tomtom-orbis-maps");
    expectToolsToTargetBackend(result, "tomtom-maps");
  });

  it("returns tomtom-maps tools when no header is provided", async () => {
    const result = await listTools(TEST_PORT);
    expectToolsToTargetBackend(result, "tomtom-maps");
  });
});
