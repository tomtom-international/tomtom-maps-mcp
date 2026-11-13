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

import { ClientNotificationSchema, ClientRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { requestDurationSeconds, requestsTotal } from "./metrics/metrics";
import type { McpRequestLog } from "./requestLog";

const ROUTES = ["mcp", "protected_resource", "client_metadata", "inspector_client"] as const;
export type LoggedRoute = (typeof ROUTES)[number];

const JSON_RPC_METHODS: string[] = [
  ...ClientRequestSchema.options,
  ...ClientNotificationSchema.options,
].map((schema) => schema.shape.method.value);

export const REQUEST_METHODS = [
  ...JSON_RPC_METHODS,
  ...ROUTES.filter((route) => route !== "mcp"),
  "other",
];

function requestMethod(route: LoggedRoute, jsonRpcMethod: string | undefined): string {
  if (route !== "mcp") return route;
  return jsonRpcMethod !== undefined && JSON_RPC_METHODS.includes(jsonRpcMethod)
    ? jsonRpcMethod
    : "other";
}

export function recordRequestMetrics(
  route: LoggedRoute,
  mcpRequest: Pick<McpRequestLog, "method" | "auth"> | undefined,
  status: number,
  seconds: number
): void {
  const method = requestMethod(route, mcpRequest?.method);
  requestsTotal.inc({ method, status: String(status), auth: mcpRequest?.auth ?? "none" });
  requestDurationSeconds.observe({ method }, seconds);
}
