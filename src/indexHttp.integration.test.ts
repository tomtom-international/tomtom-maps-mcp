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

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHttpServer, type HttpServerResult } from "./indexHttp";

const TEST_API_KEY = "test-api-key";

interface ToolsListResponse {
  jsonrpc: string;
  id: number;
  result?: {
    tools: Array<{
      name: string;
      _meta?: { backend?: string };
    }>;
  };
}

interface HealthResponse {
  status: string;
  version: string;
  mode: string;
  backends?: string[];
  backend?: string;
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

/** Helper to call tools/list endpoint */
async function callToolsList(port: number, backend?: string): Promise<ToolsListResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json,text/event-stream",
    "tomtom-api-key": TEST_API_KEY,
  };
  if (backend) {
    headers["tomtom-maps-backend"] = backend;
  }

  const response = await fetch(`http://localhost:${port}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });

  return parseSSEResponse(await response.text());
}

/** Helper to call health endpoint */
async function callHealth(port: number): Promise<HealthResponse> {
  const response = await fetch(`http://localhost:${port}/health`);
  return response.json();
}

describe("HTTP Server Integration - Dual Backend Mode", () => {
  let serverResult: HttpServerResult;
  const TEST_PORT = 3998;

  beforeAll(async () => {
    serverResult = await createHttpServer({
      port: TEST_PORT,
      fixedBackend: null, // Dual mode
      defaultBackend: "genesis",
    });
  });

  afterAll(async () => {
    await serverResult.shutdown();
  });

  it("health endpoint returns dual mode with both backends", async () => {
    const health = await callHealth(TEST_PORT);

    expect(health.status).toBe("ok");
    expect(health.mode).toBe("dual");
    expect(health.backends).toContain("genesis");
    expect(health.backends).toContain("orbis");
    expect(health.default).toBe("genesis");
  });

  it("returns genesis tools with _meta.backend='genesis' when header is 'genesis'", async () => {
    const result = await callToolsList(TEST_PORT, "genesis");

    expect(result.result?.tools).toBeDefined();
    expect(result.result!.tools.length).toBeGreaterThan(0);
    for (const tool of result.result!.tools) {
      expect(tool._meta?.backend).toBe("genesis");
    }
  });

  it("returns orbis tools with _meta.backend='orbis' when header is 'orbis'", async () => {
    const result = await callToolsList(TEST_PORT, "orbis");

    expect(result.result?.tools).toBeDefined();
    expect(result.result!.tools.length).toBeGreaterThan(0);
    for (const tool of result.result!.tools) {
      expect(tool._meta?.backend).toBe("orbis");
    }
  });

  it("defaults to genesis when no header is provided", async () => {
    const result = await callToolsList(TEST_PORT);

    expect(result.result?.tools).toBeDefined();
    for (const tool of result.result!.tools) {
      expect(tool._meta?.backend).toBe("genesis");
    }
  });

  it("verifies _meta.backend for all tools", async () => {
    const genesisResult = await callToolsList(TEST_PORT, "genesis");
    const orbisResult = await callToolsList(TEST_PORT, "orbis");

    const genesisTools = genesisResult.result!.tools;
    const orbisTools = orbisResult.result!.tools;

    // Genesis should have static-map, Orbis should not
    const genesisNames = genesisTools.map((t) => t.name);
    const orbisNames = orbisTools.map((t) => t.name);
    expect(genesisNames).toContain("tomtom-static-map");
    expect(orbisNames).not.toContain("tomtom-static-map");

    // Verify ALL Genesis tools have _meta.backend = "genesis"
    for (const tool of genesisTools) {
      expect(tool._meta?.backend, `Genesis tool '${tool.name}' should have backend='genesis'`).toBe("genesis");
    }

    // Verify ALL Orbis tools have _meta.backend = "orbis"
    for (const tool of orbisTools) {
      expect(tool._meta?.backend, `Orbis tool '${tool.name}' should have backend='orbis'`).toBe("orbis");
    }
  });
});

describe("HTTP Server Integration - Fixed Backend Mode (Orbis)", () => {
  let serverResult: HttpServerResult;
  const TEST_PORT = 3997;

  beforeAll(async () => {
    serverResult = await createHttpServer({
      port: TEST_PORT,
      fixedBackend: "orbis",
    });
  });

  afterAll(async () => {
    await serverResult.shutdown();
  });

  it("health endpoint returns fixed mode with orbis backend", async () => {
    const health = await callHealth(TEST_PORT);

    expect(health.status).toBe("ok");
    expect(health.mode).toBe("fixed");
    expect(health.backend).toBe("orbis");
    expect(health.backends).toBeUndefined();
  });

  it("always returns orbis tools even when header requests genesis", async () => {
    const result = await callToolsList(TEST_PORT, "genesis");

    expect(result.result?.tools).toBeDefined();
    for (const tool of result.result!.tools) {
      expect(tool._meta?.backend).toBe("orbis");
    }
  });

  it("returns orbis tools when no header is provided", async () => {
    const result = await callToolsList(TEST_PORT);

    expect(result.result?.tools).toBeDefined();
    for (const tool of result.result!.tools) {
      expect(tool._meta?.backend).toBe("orbis");
    }
  });
});

describe("HTTP Server Integration - Fixed Backend Mode (Genesis)", () => {
  let serverResult: HttpServerResult;
  const TEST_PORT = 3996;

  beforeAll(async () => {
    serverResult = await createHttpServer({
      port: TEST_PORT,
      fixedBackend: "genesis",
    });
  });

  afterAll(async () => {
    await serverResult.shutdown();
  });

  it("health endpoint returns fixed mode with genesis backend", async () => {
    const health = await callHealth(TEST_PORT);

    expect(health.status).toBe("ok");
    expect(health.mode).toBe("fixed");
    expect(health.backend).toBe("genesis");
    expect(health.backends).toBeUndefined();
  });

  it("always returns genesis tools even when header requests orbis", async () => {
    const result = await callToolsList(TEST_PORT, "orbis");

    expect(result.result?.tools).toBeDefined();
    for (const tool of result.result!.tools) {
      expect(tool._meta?.backend).toBe("genesis");
    }
  });

  it("returns genesis tools when no header is provided", async () => {
    const result = await callToolsList(TEST_PORT);

    expect(result.result?.tools).toBeDefined();
    for (const tool of result.result!.tools) {
      expect(tool._meta?.backend).toBe("genesis");
    }
  });
});
