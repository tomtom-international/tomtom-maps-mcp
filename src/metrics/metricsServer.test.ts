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

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { readVersion } from "../utils/readVersion";
import { startMetricsServer } from "./metricsServer";

let server: Server | undefined;

async function get(path: string): Promise<Response> {
  server = await startMetricsServer(0);
  const { port } = server.address() as AddressInfo;
  return fetch(`http://localhost:${port}${path}`);
}

afterEach(async () => {
  await new Promise((resolve) => server?.close(resolve));
});

describe("startMetricsServer", () => {
  it("serves the metrics in Prometheus text format, the build's version included", async () => {
    const response = await get("/metrics");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/plain; version=0\.0\.4/);
    expect(body).toContain(`mcp_build_info{version="${readVersion()}"} 1`);
    expect(body).toContain("process_cpu_user_seconds_total");
  });

  it("serves nothing but the metrics", async () => {
    expect((await get("/health")).status).toBe(404);
  });

  it("fails to start when its port is taken, rather than crashing the process", async () => {
    server = await startMetricsServer(0);
    const { port } = server.address() as AddressInfo;

    await expect(startMetricsServer(port)).rejects.toMatchObject({ code: "EADDRINUSE" });
  });
});
