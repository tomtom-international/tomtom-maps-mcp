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

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema,
  type ServerNotification,
  type ServerRequest,
  type ServerResult,
} from "@modelcontextprotocol/sdk/types.js";
import { callerForLog } from "../clientSession";
import { errorResult, type MCPResponse } from "../handlers/shared/responseTrimmer";
import { IncorrectError } from "../types/types";
import { logger } from "../utils/logger";

/** A tool the server no longer lists, and what a call to it is told instead (ADR 0010). */
export interface RetiredTool {
  /** The last release that listed the tool. */
  lastRelease: string;
  /** The listed tools that do its job now; empty when none does. */
  replacedBy: readonly string[];
  /** What the caller reads: the tools to call instead and how its inputs map, or why none does. */
  message: string;
}

/** Every tool name a release listed that the server no longer registers. */
export const RETIRED_TOOLS: ReadonlyMap<string, RetiredTool> = new Map([
  [
    "tomtom-static-map",
    {
      lastRelease: "1.6.10",
      replacedBy: ["tomtom-dynamic-map"],
      message:
        "tomtom-static-map was removed: the TomTom Orbis Maps APIs have no static-map endpoint. " +
        "Use tomtom-dynamic-map, which draws an interactive map in clients that render MCP apps: center, bbox, zoom, " +
        "width and height carry over; style, layer, format, view and language have no counterpart.",
    },
  ],
  [
    "tomtom-waypoint-routing",
    {
      lastRelease: "1.6.10",
      replacedBy: ["tomtom-routing"],
      message:
        "tomtom-waypoint-routing was removed. Use tomtom-routing: waypoints becomes locations, in the same order, " +
        "and each { lat, lon } becomes [longitude, latitude]. routeType, travelMode, traffic, avoid, departAt, arriveAt, " +
        "maxAlternatives, vehicleMaxSpeed, vehicleWeight, vehicleHeading and sectionType carry over; the other options don't.",
    },
  ],
  [
    "tomtom-ev-routing",
    {
      lastRelease: "1.6.11",
      replacedBy: ["tomtom-routing", "tomtom-search-along-route"],
      message:
        "tomtom-ev-routing was removed: charging stops are no longer planned. Use tomtom-routing for the route, " +
        "with origin, waypoints and destination as its locations, in that order; the battery and charging inputs " +
        "have no counterpart. Then call tomtom-search-along-route with the query 'EV charging' for chargers along it.",
    },
  ],
  [
    "tomtom-reachable-range",
    {
      lastRelease: "1.6.11",
      replacedBy: [],
      message:
        "tomtom-reachable-range was removed: the Reachable Range API refuses default TomTom API keys. " +
        "No tool computes a reachable area; tomtom-routing gives the travel time to a known destination.",
    },
  ],
  [
    "tomtom-get-viz-data",
    {
      lastRelease: "1.6.12",
      replacedBy: ["tomtom-get-app-data"],
      message:
        "tomtom-get-viz-data was removed. The data-viz app gets data missing from the result from " +
        "tomtom-get-app-data, with the tomtom-data-viz arguments; reload the app.",
    },
  ],
]);

/**
 * The error result for a call to a retired tool. A replacement missing from `listed`, the tools
 * this client is offered, is dropped from `replacedBy` and named as not offered.
 */
export function retiredToolError(
  name: string,
  retired: RetiredTool,
  listed: ReadonlySet<string>
): MCPResponse {
  const replacedBy = retired.replacedBy.filter((tool) => listed.has(tool));
  const notOffered = retired.replacedBy.filter((tool) => !listed.has(tool));
  const message = notOffered.length
    ? `${retired.message} This client isn't offered ${notOffered.join(" or ")}.`
    : retired.message;
  return errorResult(
    new IncorrectError(message, { tool: name, lastRelease: retired.lastRelease, replacedBy })
  );
}

type RequestHandler = (
  request: unknown,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>
) => Promise<ServerResult>;

/**
 * Answers a call to a retired tool with its error, and passes every other call to the MCP
 * SDK's tools/call handler, which tells an unknown name only that it was not found. Call it
 * after registering the tools: the SDK installs its handler with the first one.
 */
export function answerRetiredTools(server: McpServer): void {
  const handlers = sdkRequestHandlers(server);
  const sdkCallTool = handlers?.get(CallToolRequestSchema.shape.method.value);
  const sdkListTools = handlers?.get(ListToolsRequestSchema.shape.method.value);
  if (!sdkCallTool || !sdkListTools) {
    throw new Error("The MCP SDK's tools handlers were not found: register the tools first");
  }
  server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name } = request.params;
    const retired = RETIRED_TOOLS.get(name);
    if (!retired) return sdkCallTool(request, extra);
    logger.warn({ tool: name, ...callerForLog(server, extra) }, "Retired tool called");
    const { tools } = ListToolsResultSchema.parse(
      await sdkListTools({ method: ListToolsRequestSchema.shape.method.value }, extra)
    );
    return retiredToolError(name, retired, new Set(tools.map((tool) => tool.name)));
  });
}

/** The SDK offers no getter for the handlers it installs; `retiredTools.test.ts` fails if it renames them. */
function sdkRequestHandlers(server: McpServer): ReadonlyMap<string, RequestHandler> | undefined {
  return (server.server as unknown as { _requestHandlers?: Map<string, RequestHandler> })
    ._requestHandlers;
}
