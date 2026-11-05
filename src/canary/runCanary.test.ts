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

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../utils/logger";
import type { CanaryCase } from "./canaryCases";
import { runCanary } from "./runCanary";

const API_KEY = "canary-key";

interface Seen {
  apiKeys: (string | undefined)[];
  clientNames: string[];
}

const passing = (tool: string): CanaryCase => ({ tool, arguments: {}, check: () => [] });

async function readBody(request: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : undefined;
}

// A stateless MCP server whose tools answer `{}`, or fail when named "failing"
async function startStubServer(seen: Seen): Promise<{ server: Server; url: string }> {
  const server = createServer(async (request, response) => {
    seen.apiKeys.push(request.headers["tomtom-api-key"] as string | undefined);
    const body = (await readBody(request)) as
      | { method?: string; params?: { clientInfo?: { name: string } } }
      | undefined;
    if (body?.method === "initialize" && body.params?.clientInfo) {
      seen.clientNames.push(body.params.clientInfo.name);
    }
    const mcp = new McpServer({ name: "stub", version: "0.0.0" });
    for (const tool of ["tomtom-geocode", "failing"]) {
      mcp.registerTool(tool, {}, async () => ({
        content: [{ type: "text", text: tool === "failing" ? '{"error":"upstream down"}' : "{}" }],
        isError: tool === "failing",
      }));
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await mcp.connect(transport);
    await transport.handleRequest(request, response, body);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return { server, url: `http://localhost:${(server.address() as AddressInfo).port}/mcp` };
}

describe("runCanary", () => {
  let stub: { server: Server; url: string };
  let seen: Seen;

  beforeEach(async () => {
    seen = { apiKeys: [], clientNames: [] };
    stub = await startStubServer(seen);
    vi.spyOn(logger, "info").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await new Promise((resolve) => stub.server.close(resolve));
  });

  it("connects as the canary client with the API key on every request", async () => {
    await runCanary(stub.url, API_KEY, [passing("tomtom-geocode")]);

    expect(seen.clientNames).toEqual(["tomtom-mcp-canary"]);
    expect(seen.apiKeys.length).toBeGreaterThan(1);
    expect(new Set(seen.apiKeys)).toEqual(new Set([API_KEY]));
  });

  it("passes and logs each case when every check holds", async () => {
    const passed = await runCanary(stub.url, API_KEY, [passing("tomtom-geocode")]);

    expect(passed).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      {
        case: "tomtom-geocode",
        pass: true,
        durationMs: expect.any(Number),
        slow: false,
        failures: [],
      },
      "Canary result"
    );
  });

  it("fails and logs as an error a case whose check finds something wrong", async () => {
    const wrong: CanaryCase = {
      tool: "tomtom-geocode",
      arguments: {},
      check: () => ["no results"],
    };

    expect(await runCanary(stub.url, API_KEY, [wrong, passing("tomtom-geocode")])).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ case: "tomtom-geocode", pass: false, failures: ["no results"] }),
      "Canary result"
    );
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it("fails a case whose tool answers with an error, quoting it", async () => {
    expect(await runCanary(stub.url, API_KEY, [passing("failing")])).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        case: "failing",
        failures: ['tool answered with an error: {"error":"upstream down"}'],
      }),
      "Canary result"
    );
  });

  it("fails a case whose call throws, and still runs the next", async () => {
    expect(
      await runCanary(stub.url, API_KEY, [passing("not-registered"), passing("tomtom-geocode")])
    ).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ case: "not-registered", failures: [expect.any(String)] }),
      "Canary result"
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ case: "tomtom-geocode", pass: true }),
      "Canary result"
    );
  });

  it("flags a case slower than 5 s without failing it", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 5001));

    expect(await runCanary(stub.url, API_KEY, [passing("tomtom-geocode")])).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ slow: true }),
      "Canary result"
    );
  });
});
