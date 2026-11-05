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

import { beforeEach, describe, expect, it } from "vitest";
import { metricsRegistry } from "./metrics/metrics";
import { type LoggedRoute, REQUEST_METHODS, recordRequestMetrics } from "./requestMetrics";

async function metricValues(name: string) {
  return (await metricsRegistry.getSingleMetric(name)?.get())?.values ?? [];
}

describe("recordRequestMetrics", () => {
  beforeEach(() => {
    metricsRegistry.getSingleMetric("mcp_requests_total")?.reset();
    metricsRegistry.getSingleMetric("mcp_request_duration_seconds")?.reset();
  });

  it("counts and times an MCP request by its JSON-RPC method, status and auth", async () => {
    recordRequestMetrics("mcp", { method: "tools/list", auth: "tomtom-api-key" }, 200, 0.3);

    expect(await metricValues("mcp_requests_total")).toEqual([
      { labels: { method: "tools/list", status: "200", auth: "tomtom-api-key" }, value: 1 },
    ]);
    expect(await metricValues("mcp_request_duration_seconds")).toContainEqual(
      expect.objectContaining({
        labels: { method: "tools/list", le: 0.5 },
        metricName: "mcp_request_duration_seconds_bucket",
        value: 1,
      })
    );
  });

  it.each([["made/up"], [undefined]])(
    "counts an MCP request with an unexpected method %o as other, never as sent",
    async (method) => {
      recordRequestMetrics("mcp", { method, auth: "oauth" }, 200, 0.1);

      expect(await metricValues("mcp_requests_total")).toEqual([
        expect.objectContaining({ labels: expect.objectContaining({ method: "other" }) }),
      ]);
    }
  );

  it.each<LoggedRoute>(["protected_resource", "client_metadata", "inspector_client"])(
    "counts a %s request by its route, without auth",
    async (route) => {
      recordRequestMetrics(route, undefined, 200, 0.1);

      expect(await metricValues("mcp_requests_total")).toEqual([
        { labels: { method: route, status: "200", auth: "none" }, value: 1 },
      ]);
    }
  );

  it("labels every request with a method from its closed set, the SDK's JSON-RPC methods included", () => {
    expect(REQUEST_METHODS).toEqual(
      expect.arrayContaining(["initialize", "tools/call", "notifications/initialized", "other"])
    );
    expect(new Set(REQUEST_METHODS).size).toBe(REQUEST_METHODS.length);
  });
});
