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

import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from "@prometheus-io/client";
import { readVersion } from "../utils/readVersion";

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

// Joined on by queries that split a metric per version, so no other metric carries one
new Gauge({
  name: "mcp_build_info",
  help: "The running server's version, always 1",
  labelNames: ["version"],
  registers: [metricsRegistry],
}).set({ version: readVersion() }, 1);

// Fewer than 8 buckets by KaaP governance; 7 s is the ToolSlow alert's bound
const DURATION_BUCKETS_SECONDS = [0.1, 0.25, 0.5, 1, 2.5, 7];

export const requestsTotal = new Counter({
  name: "mcp_requests_total",
  help: "Requests answered, by JSON-RPC method or route, HTTP status and auth method",
  labelNames: ["method", "status", "auth"],
  registers: [metricsRegistry],
});

export const requestDurationSeconds = new Histogram({
  name: "mcp_request_duration_seconds",
  help: "Time to answer a request, by JSON-RPC method or route",
  labelNames: ["method"],
  buckets: DURATION_BUCKETS_SECONDS,
  registers: [metricsRegistry],
});

const RESULT_BUCKETS_BYTES = [1024, 4096, 16384, 65536, 262144, 1048576];

export const upstreamDurationSeconds = new Histogram({
  name: "mcp_upstream_duration_seconds",
  help: "Time an upstream call took to answer or fail, by upstream",
  labelNames: ["upstream"],
  buckets: DURATION_BUCKETS_SECONDS,
  registers: [metricsRegistry],
});

export const upstreamFailuresTotal = new Counter({
  name: "mcp_upstream_failures_total",
  help: "Upstream calls that failed, by upstream and error kind",
  labelNames: ["upstream", "error_kind"],
  registers: [metricsRegistry],
});

export const bearerRejectionsTotal = new Counter({
  name: "mcp_bearer_rejections_total",
  help: "Bearer tokens rejected, by reason: missing, untrusted_issuer, expired or invalid",
  labelNames: ["reason"],
  registers: [metricsRegistry],
});

export const toolCallsTotal = new Counter({
  name: "mcp_tool_calls_total",
  help: "Tool calls, by tool, client family, outcome and error kind",
  labelNames: ["tool", "client_family", "outcome", "error_kind"],
  registers: [metricsRegistry],
});

export const toolDurationSeconds = new Histogram({
  name: "mcp_tool_duration_seconds",
  help: "Time to answer a tool call, by tool",
  labelNames: ["tool"],
  buckets: DURATION_BUCKETS_SECONDS,
  registers: [metricsRegistry],
});

export const toolResultBytes = new Histogram({
  name: "mcp_tool_result_bytes",
  help: "Size of a tool result, by tool and by the part the model or only an app reads",
  labelNames: ["tool", "part"],
  buckets: RESULT_BUCKETS_BYTES,
  registers: [metricsRegistry],
});

export const toolOptionalInputTotal = new Counter({
  name: "mcp_tool_optional_input_total",
  help: "Tool calls that sent an optional input, by tool, input and client family",
  labelNames: ["tool", "input", "client_family"],
  registers: [metricsRegistry],
});

export const toolInputOptionTotal = new Counter({
  name: "mcp_tool_input_option_total",
  help: "Tool calls that chose an option of a fixed-list input, by tool, input, option and client family",
  labelNames: ["tool", "input", "option", "client_family"],
  registers: [metricsRegistry],
});
