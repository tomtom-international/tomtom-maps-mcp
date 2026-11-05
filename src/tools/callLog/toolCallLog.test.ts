/*
 * Copyright (C) 2026 TomTom Navigation B.V.
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

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APPS_CLIENT, connectInMemory } from "../../inMemoryClient";
import { cannedApiResponse } from "../../services/shared/cannedApiResponses";
import { recordFetch } from "../../services/shared/recordFetch";
import { RequestContextHolder } from "../../requestContextHolder";
import { BusyError } from "../../types/types";
import { metricsRegistry } from "../../metrics/metrics";
import { logger } from "../../utils/logger";
import { TOOL_CALLS_REACHING_TOMTOM } from "../toolBaselines";
import { recordOutcome } from "../../handlers/shared/toolCallOutcome";
import { logToolCalls } from "./toolCallLog";

vi.mock("../../services/search/searchService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/search/searchService")>()),
  fetchPOICategories: async () => ({ poiCategories: [{ id: 9379, name: "Bar" }] }),
  geocodeAddress: async () => {
    throw new BusyError("The service is busy", {}, { upstream: "tomtom-geocoding" });
  },
  reverseGeocode: async () => {
    throw new TypeError("reading 'lat' of undefined");
  },
}));

vi.mock("../helpers/registerTomTomAppTool.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../helpers/registerTomTomAppTool.js")>()),
  appDataOf: async () => ({ appData: undefined, result: { content: [], isError: false } }),
}));

type Level = "info" | "warn" | "error";

function toolCalledLines(): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = [];
  for (const level of ["info", "warn", "error"] as const satisfies Level[]) {
    vi.spyOn(logger, level).mockImplementation((data, message) => {
      if (message === "Tool called")
        lines.push({ level, ...RequestContextHolder.current(), ...(data as object) });
    });
  }
  return lines;
}

async function call(
  name: string,
  args: Record<string, unknown>,
  client = "claude-ai"
): Promise<Record<string, unknown>[]> {
  const lines = toolCalledLines();
  const connected = await connectInMemory(client, client === "claude-ai" ? APPS_CLIENT : {});
  await connected.callTool({ name, arguments: args });
  await connected.close();
  return lines;
}

describe("the Tool called line", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("is logged exactly once, under its name, for every tool the server registers", async () => {
    recordFetch(cannedApiResponse);
    const baselines = new Map(TOOL_CALLS_REACHING_TOMTOM);
    const lister = await connectInMemory("claude-ai", APPS_CLIENT);
    const { tools } = await lister.listTools();
    await lister.close();

    for (const { name } of tools) {
      const lines = await call(name, baselines.get(name) ?? {});
      expect(
        lines.map((line) => line.tool),
        name
      ).toEqual([name]);
      vi.restoreAllMocks();
      recordFetch(cannedApiResponse);
    }
    expect(tools.length).toBeGreaterThan(10);
  });

  it("is logged once for a call that succeeds, with the tool, client and duration", async () => {
    const lines = await call("tomtom-poi-categories", { filters: ["bar"] });

    expect(lines).toEqual([
      expect.objectContaining({
        level: "info",
        tool: "tomtom-poi-categories",
        outcome: "ok",
        client: "claude-ai",
        durationMs: expect.any(Number),
      }),
    ]);
  });

  it("records the call's metrics with the line", async () => {
    const counted = metricsRegistry.getSingleMetric("mcp_tool_calls_total");
    counted?.reset();

    await call("tomtom-geocode", { query: "Amsterdam Centraal" });

    expect((await counted?.get())?.values).toEqual([
      expect.objectContaining({
        labels: expect.objectContaining({ tool: "tomtom-geocode", outcome: "upstream_error" }),
        value: 1,
      }),
    ]);
  });

  it("names the upstream behind a failure, as the only line of the failed call", async () => {
    const logged: string[] = [];
    vi.spyOn(logger, "debug").mockImplementation(() => undefined);
    const lines = await call("tomtom-geocode", { query: "Dam 1, Amsterdam" });
    for (const spy of [logger.info, logger.warn, logger.error]) {
      for (const [, message] of vi.mocked(spy).mock.calls) logged.push(String(message));
    }

    expect(lines).toEqual([
      expect.objectContaining({
        level: "error",
        tool: "tomtom-geocode",
        outcome: "upstream_error",
        errorKind: "BusyError",
        upstream: "tomtom-geocoding",
      }),
    ]);
    expect(logged).not.toContain("Tool call failed");
  });

  it("keeps the cause of a failure the tool did not expect", async () => {
    const lines = await call("tomtom-reverse-geocode", { position: [4.9, 52.37] });

    expect(lines).toEqual([
      expect.objectContaining({
        level: "error",
        outcome: "tool_error",
        errorKind: "UnknownError",
        error: "TypeError: reading 'lat' of undefined",
      }),
    ]);
  });

  it("counts arguments the SDK rejects as the caller's mistake, without the SDK's message", async () => {
    const lines = await call("tomtom-geocode", { query: 42 });

    expect(lines).toEqual([
      expect.objectContaining({
        level: "warn",
        outcome: "tool_error",
        errorKind: "IncorrectError",
      }),
    ]);
    expect(lines[0]).not.toHaveProperty("error");
  });

  it("counts a tool the server does not have as not found, naming it only when it looks like a name", async () => {
    const invented = await call("tomtom-teleport", {});
    const unnameable = await call("drop table tools; --", {});

    expect(invented).toEqual([
      expect.objectContaining({ tool: "tomtom-teleport", errorKind: "NotFoundError" }),
    ]);
    expect(unnameable).toEqual([expect.objectContaining({ tool: "<other>" })]);
  });

  it("counts a tool this client is not offered as not found", async () => {
    const lines = await call("tomtom-dynamic-map", {}, "claude-code");

    expect(lines).toEqual([
      expect.objectContaining({ tool: "tomtom-dynamic-map", errorKind: "NotFoundError" }),
    ]);
  });

  it("records a call to a retired tool, to tell when its entry can go", async () => {
    const lines = await call("tomtom-reachable-range", {});

    expect(lines).toEqual([
      expect.objectContaining({
        level: "info",
        tool: "tomtom-reachable-range",
        outcome: "retired",
      }),
    ]);
  });

  it("records a call on a previous contract and the old inputs it sent, to tell when its entry can go", async () => {
    const lines = await call("tomtom-routing", {
      locations: [
        [4.9, 52.37],
        [4.88, 52.36],
      ],
      currentChargeInkWh: 40,
    });

    expect(lines).toEqual([
      expect.objectContaining({
        level: "info",
        tool: "tomtom-routing",
        outcome: "previous_contract",
        inputs: ["currentChargeInkWh"],
      }),
    ]);
  });

  it("counts an app asking for the API key while there is none as forbidden", async () => {
    vi.stubEnv("TOMTOM_API_KEY", "");
    const lines = await call("tomtom-get-api-key", {});

    expect(lines).toEqual([
      expect.objectContaining({
        level: "error",
        outcome: "tool_error",
        errorKind: "ForbiddenError",
      }),
    ]);
  });

  it("counts app data that could not be produced as the server's fault", async () => {
    const lines = await call("tomtom-get-app-data", {
      tool: "tomtom-data-viz",
      arguments: {},
      reason: "not_inline",
    });

    expect(lines).toEqual([
      expect.objectContaining({ level: "error", outcome: "tool_error", errorKind: "FaultError" }),
    ]);
  });
});

describe("a failed result nothing recorded, as a future tool could return", () => {
  const results: Record<string, unknown> = {
    "text-error": { content: [{ type: "text", text: "boom" }], isError: true },
    "image-error": {
      content: [{ type: "image", data: "AA==", mimeType: "image/png" }],
      isError: true,
    },
    "malformed-error": { content: 42, isError: true },
  };

  afterEach(() => vi.restoreAllMocks());

  it.each(Object.keys(results))("is still logged, as an unknown error, for %s", async (name) => {
    const server = new McpServer({ name: "bare", version: "1.0.0" });
    server.registerTool(name, { inputSchema: {} }, async () => results[name] as CallToolResult);
    logToolCalls(server);
    const client = new Client({ name: "claude-ai", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const lines = toolCalledLines();

    await client.callTool({ name, arguments: {} }).catch(() => undefined);
    await client.close();

    expect(lines).toEqual([
      expect.objectContaining({
        level: "error",
        tool: name,
        outcome: "tool_error",
        errorKind: "UnknownError",
      }),
    ]);
  });
});

describe("what the Tool called line says about a call's inputs and result", () => {
  afterEach(() => vi.restoreAllMocks());

  async function callAndRead(name: string, args: Record<string, unknown>) {
    recordFetch(cannedApiResponse);
    const lines = toolCalledLines();
    const client = await connectInMemory("claude-ai", APPS_CLIENT);
    const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
    await client.close();
    return { line: lines[0] ?? {}, result };
  }

  it("names the optional and unsupported inputs sent and the options chosen, never a value", async () => {
    const { line } = await callAndRead("tomtom-fuzzy-search", {
      query: "coffee near the station",
      limit: 5,
      response_detail: "compact",
      avoidTolls: "my street",
    });

    expect(line).toMatchObject({
      optionalInputs: ["limit", "response_detail"],
      unsupportedInputs: ["avoidTolls"],
      chosenInputOptions: [{ input: "response_detail", option: "compact" }],
    });
    expect(line).not.toHaveProperty("invalidInputs");
    expect(JSON.stringify(line)).not.toMatch(/coffee near the station|my street/);
  });

  it("names the inputs the SDK rejected", async () => {
    const { line } = await callAndRead("tomtom-geocode", { query: 42 });

    expect(line).toMatchObject({ errorKind: "IncorrectError", invalidInputs: ["query"] });
  });

  it("names no inputs for a tool the server does not register", async () => {
    const { line } = await callAndRead("tomtom-reachable-range", { origin: [4.9, 52.37] });

    expect(line).not.toHaveProperty("optionalInputs");
    expect(line).not.toHaveProperty("unsupportedInputs");
  });

  it("measures the bytes that reach the model and those only the app reads", async () => {
    const { line, result } = await callAndRead("tomtom-dynamic-map", {
      markers: [{ lat: 52.37, lon: 4.89 }],
    });

    expect(line.resultBytes).toBe(
      Buffer.byteLength(
        JSON.stringify({ content: result.content, structuredContent: result.structuredContent })
      )
    );
    expect(line.appBytes).toBe(Buffer.byteLength(JSON.stringify(result._meta)));
    expect(line.appBytes).toBeGreaterThan(0);
  });

  it("marks a call that succeeded only in part as degraded", async () => {
    const server = new McpServer({ name: "bare", version: "1.0.0" });
    server.registerTool("partial", { inputSchema: {} }, async () => {
      recordOutcome({ outcome: "ok", degraded: true });
      return { content: [{ type: "text", text: "2 of 3 routes" }] };
    });
    logToolCalls(server);
    const client = new Client({ name: "claude-ai", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const lines = toolCalledLines();

    await client.callTool({ name: "partial", arguments: {} });
    await client.close();

    expect(lines).toEqual([
      expect.objectContaining({ level: "info", outcome: "ok", degraded: true, appBytes: 0 }),
    ]);
  });
});
