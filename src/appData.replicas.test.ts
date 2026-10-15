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

// Apps on a server of several replicas (CONTEXT.md, App data): two server
// processes behind a proxy that sends every request to the other one, so a
// fetch never reaches the replica that ran the tool, and the app's own loader.

import { type ChildProcess, spawn } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { App } from "@modelcontextprotocol/ext-apps";
import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { trackAppData } from "./apps/shared/appData";
import { APP_DATA_META_KEY } from "./constants";

const API_KEY = process.env.TOMTOM_API_KEY;

interface Replica {
  port: number;
  process: ChildProcess;
  logs: Array<{ msg: string; data?: Record<string, unknown> }>;
}

const replicas: Replica[] = [];
let proxy: http.Server;
let proxyPort: number;
/** When set, the proxy drops each result's _meta, as a host that loses it would. */
let dropResultMeta = false;

async function freePort(): Promise<number> {
  const server = http.createServer().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startReplica(): Promise<Replica> {
  const port = await freePort();
  const child = spawn(process.execPath, ["--import", "tsx", "src/indexHttp.ts"], {
    env: { ...process.env, PORT: String(port), LOG_LEVEL: "info", TOMTOM_API_KEY: "" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const replica: Replica = { port, process: child, logs: [] };
  let buffered = "";
  // The server logs to stderr, keeping stdout for stdio JSON-RPC.
  child.stderr?.on("data", (chunk: Buffer) => {
    buffered += chunk.toString();
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      try {
        replica.logs.push(JSON.parse(line));
      } catch {
        // Not a log line.
      }
    }
  });
  const started = Date.now();
  while (!replica.logs.some((log) => log.msg === "TomTom MCP HTTP Server started")) {
    if (Date.now() - started > 60_000) throw new Error(`replica on ${port} did not start`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return replica;
}

/** Each result's _meta removed from a JSON or server-sent-events response body. */
function withoutResultMeta(body: string): string {
  const strip = (json: string) => {
    const message = JSON.parse(json);
    if (message.result) delete message.result._meta;
    return JSON.stringify(message);
  };
  if (body.trimStart().startsWith("{")) return strip(body);
  return body.replace(/^data: (.*)$/gm, (_, json: string) => `data: ${strip(json)}`);
}

function startProxy(): Promise<number> {
  let next = 0;
  proxy = http.createServer((req, res) => {
    const target = replicas[next++ % replicas.length];
    const upstream = http.request(
      { port: target.port, path: req.url, method: req.method, headers: req.headers },
      (answer) => {
        const chunks: Buffer[] = [];
        answer.on("data", (chunk: Buffer) => chunks.push(chunk));
        answer.on("end", () => {
          let body = Buffer.concat(chunks).toString();
          if (dropResultMeta && body) body = withoutResultMeta(body);
          const { "content-length": _, ...headers } = answer.headers;
          res.writeHead(answer.statusCode ?? 502, headers).end(body);
        });
      }
    );
    req.pipe(upstream);
  });
  proxy.listen(0);
  return new Promise((resolve) =>
    proxy.once("listening", () => resolve((proxy.address() as AddressInfo).port))
  );
}

async function connect(): Promise<Client> {
  const client = new Client(
    { name: "claude-ai", version: "1.0.0" },
    { capabilities: { extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } } } }
  );
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${proxyPort}/mcp`),
    {
      requestInit: { headers: { "tomtom-api-key": API_KEY ?? "no-key-needed" } },
    }
  );
  await client.connect(transport);
  return client;
}

/** Calls a tool, then loads its app data the way the app does. */
async function drawAsTheApp(name: string, args: Record<string, unknown>) {
  const client = await connect();
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const listeners: Record<string, (params: unknown) => void> = {};
  const app = {
    addEventListener: (event: string, listener: (params: unknown) => void) => {
      listeners[event] = listener;
    },
    callServerTool: (params: { name: string; arguments: Record<string, unknown> }) =>
      client.callTool(params),
    sendLog: async () => {},
  };
  const tracker = trackAppData(app as unknown as App);
  listeners.toolinput({ arguments: args });
  const [content] = result.content as Array<{ type: "text"; text: string }>;
  const data = await tracker.load<Record<string, unknown>>(result, JSON.parse(content.text));
  await client.close();
  return { result, data };
}

const logged = (msg: string) =>
  replicas.flatMap((replica, index) =>
    replica.logs.filter((log) => log.msg === msg).map((log) => ({ replica: index, ...log.data }))
  );

const featureCollection = (coordinates: number[][]) =>
  JSON.stringify({
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "LineString", coordinates }, properties: {} }],
  });

describe("apps on two replicas", () => {
  beforeAll(async () => {
    replicas.push(...(await Promise.all([startReplica(), startReplica()])));
    proxyPort = await startProxy();
  }, 120_000);

  afterAll(async () => {
    for (const replica of replicas) replica.process.kill();
    await new Promise((resolve) => proxy?.close(resolve));
  });

  it("draws data that fits from the result itself", async () => {
    const geojson = featureCollection([
      [4.9, 52.37],
      [4.91, 52.38],
    ]);

    const { result, data } = await drawAsTheApp("tomtom-data-viz", {
      geojson,
      layers: [{ type: "line" }],
      show_ui: true,
    });

    expect(result._meta?.[APP_DATA_META_KEY]).toEqual(expect.any(String));
    expect(data.geojson).toEqual(JSON.parse(geojson));
  });

  it("fetches the data from the other replica when the host drops the result's _meta", async () => {
    dropResultMeta = true;
    try {
      const geojson = featureCollection([
        [4.9, 52.37],
        [4.91, 52.38],
      ]);

      const { data } = await drawAsTheApp("tomtom-data-viz", {
        geojson,
        layers: [{ type: "line" }],
        show_ui: true,
      });

      expect(data.geojson).toEqual(JSON.parse(geojson));
      const [built] = logged("App data").slice(-1);
      const fetched = logged("App data fetched: host dropped it");
      expect(fetched).toEqual([
        expect.objectContaining({
          tool: "tomtom-data-viz",
          reason: "not_inline",
          delivery: "inline",
        }),
      ]);
      expect(fetched[0].replica).not.toBe(built.replica);
    } finally {
      dropResultMeta = false;
    }
  });

  it.skipIf(!API_KEY)(
    "inlines a 3,300 km route, simplified to fit",
    async () => {
      const { result, data } = await drawAsTheApp("tomtom-routing", {
        locations: [
          [-9.1393, 38.7223],
          [21.0122, 52.2297],
        ],
        show_ui: true,
      });

      expect(result._meta?.[APP_DATA_META_KEY]).toEqual(expect.any(String));
      expect(JSON.stringify(result).length).toBeLessThan(150_000);
      expect(data).toMatchObject({ features: [{ geometry: { type: "LineString" } }] });
      expect(logged("App data")).toContainEqual(
        expect.objectContaining({
          tool: "tomtom-routing",
          delivery: "inline",
          simplification: expect.objectContaining({ max_error_m: expect.any(Number) }),
        })
      );
    },
    60_000
  );
});
