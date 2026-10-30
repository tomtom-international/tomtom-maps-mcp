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

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PLACES_AND_ROUTES } from "./appListings";
import { ENDPOINT_MCP } from "./constants";
import { createHttpServer, type HttpServerResult } from "./indexHttp";

vi.mock("./tools/helpers/appHtmlCache", () => ({
  readAppHtml: async () => "<!DOCTYPE html><html><body>map</body></html>",
}));

vi.mock("./services/search/searchService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/search/searchService")>()),
  fetchPOICategories: async () => ({ poiCategories: [{ id: 9379, name: "Bar" }] }),
}));

const PORT = 3997;
const WARM_UP_REQUESTS = 100;
const SOAK_REQUESTS = 1_000;
const HEAP_GROWTH_BUDGET_BYTES = 20 * 1024 * 1024;

const REQUESTS = [
  { query: "", method: "tools/list", params: {} },
  { query: "?apps=false", method: "tools/list", params: {} },
  { query: "", method: "resources/read", params: { uri: PLACES_AND_ROUTES } },
  {
    query: "",
    method: "tools/call",
    params: { name: "tomtom-poi-categories", arguments: { filters: ["bar"] } },
  },
];

async function send(index: number): Promise<number> {
  const { query, method, params } = REQUESTS[index % REQUESTS.length];
  const started = performance.now();
  const response = await fetch(`http://localhost:${PORT}/${ENDPOINT_MCP}${query}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json,text/event-stream",
      Connection: "close",
      "tomtom-api-key": "soak-api-key",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: index, method, params }),
  });
  const body = await response.text();
  expect(response.status, body).toBe(200);
  const json = body.startsWith("{") ? body : body.slice(body.indexOf("data: ") + "data: ".length);
  const message = JSON.parse(json);
  expect(message, method).toHaveProperty("result");
  expect(message.result.isError, method).not.toBe(true);
  return performance.now() - started;
}

async function sendAll(count: number): Promise<number[]> {
  const latencies: number[] = [];
  for (let index = 0; index < count; index++) latencies.push(await send(index));
  return latencies;
}

function heapAfterGc(): number {
  globalThis.gc?.();
  return process.memoryUsage().heapUsed;
}

const openSockets = () =>
  process.getActiveResourcesInfo().filter((resource) => resource.startsWith("TCP")).length;

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

describe("HTTP server under sustained load", () => {
  let server: HttpServerResult;

  beforeAll(async () => {
    server = await createHttpServer({ port: PORT });
  });

  afterAll(async () => {
    await server.shutdown();
  });

  it("answers 1,000 sequential requests without growing its heap or leaving sockets open", async () => {
    expect(globalThis.gc, "run with --expose-gc: pnpm test:soak").toBeTypeOf("function");
    await sendAll(WARM_UP_REQUESTS);
    const socketsBefore = openSockets();
    const heapBefore = heapAfterGc();

    const latencies = (await sendAll(SOAK_REQUESTS)).sort((a, b) => a - b);

    const heapGrowth = heapAfterGc() - heapBefore;
    process.stderr.write(
      `soak: ${SOAK_REQUESTS} requests, p50 ${percentile(latencies, 0.5).toFixed(1)} ms, p95 ${percentile(latencies, 0.95).toFixed(1)} ms, heap growth ${(heapGrowth / 1024 / 1024).toFixed(1)} MB\n`
    );
    expect(heapGrowth).toBeLessThanOrEqual(HEAP_GROWTH_BUDGET_BYTES);
    expect(openSockets()).toBeLessThanOrEqual(socketsBefore);
  });
});
