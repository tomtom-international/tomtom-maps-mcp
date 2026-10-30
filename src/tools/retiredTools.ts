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
import { IncorrectError } from "../types/types";
import { logger } from "../utils/logger";
import { errorResult } from "./shared/response-trimmer";
import type { ToolResponse } from "./shared/tool-entry";

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
      replacedBy: ["tomtom-plan-route"],
      message:
        "tomtom-waypoint-routing was removed. Use tomtom-plan-route: waypoints becomes locations, in the same order, " +
        "each { lat, lon } becoming { position: [longitude, latitude] }, or a place name as { query }. routeType, travelMode, " +
        "traffic, avoid, departAt, arriveAt and maxAlternatives carry over; the other options don't.",
    },
  ],
  [
    "tomtom-ev-routing",
    {
      lastRelease: "1.6.11",
      replacedBy: ["tomtom-plan-route", "tomtom-discover-places"],
      message:
        "tomtom-ev-routing was removed: charging stops are no longer planned. Use tomtom-plan-route for the route, " +
        "with origin, waypoints and destination as its locations, in that order, each as { position }; the battery and " +
        'charging inputs have no counterpart. Then call tomtom-discover-places with poiCategories ["ev charging"] and ' +
        'where { mode: "maxDetour", locations } for chargers along it.',
    },
  ],
  [
    "tomtom-reachable-range",
    {
      lastRelease: "1.6.11",
      replacedBy: [],
      message:
        "tomtom-reachable-range was removed: the Reachable Range API refuses default TomTom API keys. " +
        "No tool computes a reachable area; tomtom-plan-route gives the travel time to a known destination.",
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
  [
    "tomtom-fuzzy-search",
    {
      lastRelease: "1.6.14",
      replacedBy: ["tomtom-discover-places", "tomtom-locate-place"],
      message:
        "tomtom-fuzzy-search was replaced. To find places, use tomtom-discover-places: query, " +
        "poiCategories, limit, language and countries stay; position with radius becomes where { mode: " +
        '"nearby", position, radiusMeters }, boundingBox becomes where { mode: "within", boundingBox }, ' +
        'and an area\'s name goes in where { mode: "within", queries }. To locate one named place or ' +
        "address, use tomtom-locate-place with the query. The other filters and paging inputs (brandSet, " +
        "cursor, openingHours, …) have no counterpart.",
    },
  ],
  [
    "tomtom-poi-search",
    {
      lastRelease: "1.6.14",
      replacedBy: ["tomtom-discover-places"],
      message:
        "tomtom-poi-search was replaced by tomtom-discover-places: query, poiCategories, limit, language " +
        'and countries stay; position with radius becomes where { mode: "nearby", position, radiusMeters ' +
        '}, and boundingBox becomes where { mode: "within", boundingBox }. The other filters and paging ' +
        "inputs (brandSet, cursor, openingHours, …) have no counterpart.",
    },
  ],
  [
    "tomtom-nearby",
    {
      lastRelease: "1.6.14",
      replacedBy: ["tomtom-discover-places"],
      message:
        "tomtom-nearby was replaced by tomtom-discover-places: poiCategories, limit, language and " +
        'countries stay, and position with radius becomes where { mode: "nearby", position, radiusMeters ' +
        "}. The other filters and paging inputs (brandSet, cursor, openingHours, …) have no counterpart.",
    },
  ],
  [
    "tomtom-area-search",
    {
      lastRelease: "1.6.14",
      replacedBy: ["tomtom-discover-places", "tomtom-locate-place"],
      message:
        "tomtom-area-search was replaced by tomtom-discover-places: query, poiCategories, limit and " +
        'language stay; boundingBox, polygon and an area\'s name go in where { mode: "within" } as ' +
        "boundingBox, geometries (GeoJSON polygons) and queries; center with radius becomes where { mode: " +
        '"nearby", position, radiusMeters }. For an area\'s boundary, use tomtom-locate-place with ' +
        'response_detail "geometry".',
    },
  ],
  [
    "tomtom-ev-search",
    {
      lastRelease: "1.6.14",
      replacedBy: ["tomtom-discover-places"],
      message:
        'tomtom-ev-search was replaced by tomtom-discover-places with poiCategories ["ev charging"]: ' +
        "query, limit, language and countries stay, and position with radius becomes where { mode: " +
        '"nearby", position, radiusMeters }. connectorTypes, minPowerKW and cursor have no counterpart; ' +
        "each station lists its connectors and power.",
    },
  ],
  [
    "tomtom-search-along-route",
    {
      lastRelease: "1.6.14",
      replacedBy: ["tomtom-discover-places"],
      message:
        "tomtom-search-along-route was replaced by tomtom-discover-places: query, poiCategories, limit " +
        'and language stay, and origin with destination becomes where { mode: "maxDetour", locations: [{ ' +
        "position: origin }, { position: destination }], maxDetourTimeSeconds }. corridorWidth is gone: " +
        "maxDetourTimeSeconds limits the extra driving each stop adds. routeType has no counterpart.",
    },
  ],
  [
    "tomtom-geocode",
    {
      lastRelease: "1.6.14",
      replacedBy: ["tomtom-locate-place"],
      message:
        'tomtom-geocode was replaced by tomtom-locate-place: query stays, with queryAs "place" for an ' +
        'address; position with radius becomes where { mode: "nearby", position, radiusMeters }, and ' +
        'boundingBox becomes where { mode: "within", boundingBox }. It returns one place and names up to ' +
        "three others the query matched, so limit and cursor are gone; language, countries and the other " +
        "filters have no counterpart.",
    },
  ],
  [
    "tomtom-routing",
    {
      lastRelease: "1.6.14",
      replacedBy: ["tomtom-plan-route"],
      message:
        "tomtom-routing was replaced by tomtom-plan-route: each entry of locations becomes { position: [longitude, latitude] }, " +
        "or a place name as { query }. The route options stay, except vehicleMaxSpeed, vehicleWeight, vehicleHeading and sectionType.",
    },
  ],
  [
    "tomtom-traffic",
    {
      lastRelease: "1.6.14",
      replacedBy: ["tomtom-get-traffic"],
      message:
        'tomtom-traffic was replaced by tomtom-get-traffic: bbox becomes where { mode: "within", boundingBox }, or name ' +
        'the area in where { mode: "within", queries }; categoryFilter, timeValidityFilter, maxResults and language stay.',
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
): ToolResponse {
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
