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
import { metricsRegistry } from "../../metrics/metrics";
import { metricValues } from "../../metrics/metricValues";
import { RequestContextHolder } from "../../requestContextHolder";
import { recordToolCallMetrics } from "./toolCallMetrics";

const TOOL_METRICS = [
  "mcp_tool_calls_total",
  "mcp_tool_duration_seconds",
  "mcp_tool_result_bytes",
  "mcp_tool_optional_input_total",
  "mcp_tool_input_option_total",
];

const NO_INPUTS = { optionalInputs: [], unsupportedInputs: [], chosenInputOptions: [] };

const asClient = (client: string, record: () => void) =>
  RequestContextHolder.run({ requestId: "request-0001", client }, record);

describe("recordToolCallMetrics", () => {
  beforeEach(() => {
    for (const name of TOOL_METRICS) metricsRegistry.getSingleMetric(name)?.reset();
  });

  it("counts a call by tool, client family and outcome, and times it", async () => {
    asClient("claude-code", () =>
      recordToolCallMetrics({
        name: "tomtom-geocode",
        registered: true,
        outcome: { outcome: "ok" },
        seconds: 0.3,
        usage: NO_INPUTS,
      })
    );

    expect(await metricValues("mcp_tool_calls_total")).toEqual([
      {
        labels: {
          tool: "tomtom-geocode",
          client_family: "claude",
          outcome: "ok",
          error_kind: "none",
        },
        value: 1,
      },
    ]);
    expect(await metricValues("mcp_tool_duration_seconds")).toContainEqual(
      expect.objectContaining({
        labels: { tool: "tomtom-geocode", le: 0.5 },
        metricName: "mcp_tool_duration_seconds_bucket",
        value: 1,
      })
    );
  });

  it("counts a failed call under its error kind", async () => {
    recordToolCallMetrics({
      name: "tomtom-geocode",
      registered: true,
      outcome: { outcome: "upstream_error", errorKind: "BusyError", upstream: "tomtom-geocoding" },
      seconds: 0.1,
    });

    expect(await metricValues("mcp_tool_calls_total")).toEqual([
      expect.objectContaining({
        labels: expect.objectContaining({ outcome: "upstream_error", error_kind: "BusyError" }),
      }),
    ]);
  });

  it("counts a call outside any request as an unknown client", async () => {
    recordToolCallMetrics({
      name: "tomtom-geocode",
      registered: true,
      outcome: { outcome: "ok" },
      seconds: 0.1,
    });

    expect(await metricValues("mcp_tool_calls_total")).toEqual([
      expect.objectContaining({ labels: expect.objectContaining({ client_family: "unknown" }) }),
    ]);
  });

  it.each([
    [{ registered: false, outcome: { outcome: "retired" } } as const, "tomtom-reachable-range"],
    [
      {
        registered: false,
        outcome: { outcome: "tool_error", errorKind: "NotFoundError" },
      } as const,
      "unknown",
    ],
  ])(
    "names a retired tool, and any other tool the server does not register unknown: %o",
    async (call, tool) => {
      recordToolCallMetrics({ name: "tomtom-reachable-range", seconds: 0.1, ...call });

      expect(await metricValues("mcp_tool_calls_total")).toEqual([
        expect.objectContaining({ labels: expect.objectContaining({ tool }) }),
      ]);
    }
  );

  it("measures the bytes that reach the model, and those only an app reads when there are any", async () => {
    recordToolCallMetrics({
      name: "tomtom-dynamic-map",
      registered: true,
      outcome: { outcome: "ok" },
      seconds: 0.1,
      sizes: { resultBytes: 3000, appBytes: 20000 },
    });
    recordToolCallMetrics({
      name: "tomtom-geocode",
      registered: true,
      outcome: { outcome: "ok" },
      seconds: 0.1,
      sizes: { resultBytes: 500, appBytes: 0 },
    });

    const sizes = await metricValues("mcp_tool_result_bytes");
    const counted = (tool: string, part: string) =>
      expect.objectContaining({
        labels: { tool, part },
        metricName: "mcp_tool_result_bytes_count",
        value: 1,
      });
    expect(sizes).toContainEqual(counted("tomtom-dynamic-map", "model"));
    expect(sizes).toContainEqual(counted("tomtom-dynamic-map", "app"));
    expect(sizes).toContainEqual(counted("tomtom-geocode", "model"));
    expect(sizes).not.toContainEqual(counted("tomtom-geocode", "app"));
    expect(await metricValues("mcp_tool_result_bytes")).toContainEqual(
      expect.objectContaining({
        labels: { tool: "tomtom-dynamic-map", part: "app", le: 65536 },
        metricName: "mcp_tool_result_bytes_bucket",
        value: 1,
      })
    );
  });

  it("counts each optional input sent and each option chosen, never an unsupported input", async () => {
    asClient("openai-mcp/1.0.0", () =>
      recordToolCallMetrics({
        name: "tomtom-fuzzy-search",
        registered: true,
        outcome: { outcome: "ok" },
        seconds: 0.1,
        usage: {
          optionalInputs: ["limit", "response_detail"],
          unsupportedInputs: ["avoidTolls"],
          chosenInputOptions: [{ input: "response_detail", option: "compact" }],
        },
      })
    );

    expect(await metricValues("mcp_tool_optional_input_total")).toEqual([
      {
        labels: { tool: "tomtom-fuzzy-search", input: "limit", client_family: "openai" },
        value: 1,
      },
      {
        labels: { tool: "tomtom-fuzzy-search", input: "response_detail", client_family: "openai" },
        value: 1,
      },
    ]);
    expect(await metricValues("mcp_tool_input_option_total")).toEqual([
      {
        labels: {
          tool: "tomtom-fuzzy-search",
          input: "response_detail",
          option: "compact",
          client_family: "openai",
        },
        value: 1,
      },
    ]);
  });
});
