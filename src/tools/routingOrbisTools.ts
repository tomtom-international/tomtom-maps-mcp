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

// tools/routingTools.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { schemas } from "../schemas/indexOrbis";
import {
  createRoutingHandler,
  createReachableRangeHandler,
  createEVRoutingHandler,
} from "../handlers/routingOrbisHandler";
import { registerAppTool, RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";
import { registerAppResourceFromPath } from "./helpers/resourceRegistry";

// Resource URIs for routing MCP apps
const ROUTE_PLANNER_RESOURCE_URI = "ui://tomtom-routing/route-planner/app.html";
const REACHABLE_RANGE_RESOURCE_URI = "ui://tomtom-routing/reachable-range/app.html";
const EV_ROUTING_RESOURCE_URI = "ui://tomtom-routing/ev-routing/app.html";

/**
 * Creates and registers routing-related tools
 */
export async function createRoutingOrbisTools(server: McpServer): Promise<void> {
  // Register routing app resources
  await registerAppResourceFromPath(server, ROUTE_PLANNER_RESOURCE_URI, "routing", "route-planner");
  await registerAppResourceFromPath(
    server,
    REACHABLE_RANGE_RESOURCE_URI,
    "routing",
    "reachable-range"
  );

  // Routing tool with UI — supports 2-location and multi-stop routes
  registerAppTool(
    server,
    "tomtom-routing",
    {
      title: "TomTom Routing",
      description:
        "Calculate optimal routes through an ordered list of locations [origin, ...stops, destination]. Supports simple A-to-B and multi-stop itineraries. Returns turn-by-turn directions, distance, and travel time.",
      inputSchema: schemas.tomtomRoutingSchema,
      annotations: {
        title: "TomTom Routing",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: {
        backend: "tomtom-orbis-maps",
        [RESOURCE_URI_META_KEY]: ROUTE_PLANNER_RESOURCE_URI,
      },
    },
    createRoutingHandler()
  );

  // Reachable range tool with UI
  registerAppTool(
    server,
    "tomtom-reachable-range",
    {
      title: "TomTom Reachable Range",
      description:
        "Determine the area reachable within a specified time or driving distance",
      inputSchema: schemas.tomtomReachableRangeSchema,
      annotations: {
        title: "TomTom Reachable Range",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: {
        backend: "tomtom-orbis-maps",
        [RESOURCE_URI_META_KEY]: REACHABLE_RANGE_RESOURCE_URI,
      },
    },
    createReachableRangeHandler()
  );

  // EV Routing tool with UI
  await registerAppResourceFromPath(server, EV_ROUTING_RESOURCE_URI, "routing", "ev-routing");
  registerAppTool(
    server,
    "tomtom-ev-routing",
    {
      title: "TomTom EV Route Planner",
      description:
        "Plan long-distance EV routes with automatic charging stop optimization based on battery state, vehicle model, and connector compatibility.",
      inputSchema: schemas.tomtomEvRoutingSchema,
      annotations: {
        title: "TomTom EV Route Planner",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: {
        backend: "tomtom-orbis-maps",
        [RESOURCE_URI_META_KEY]: EV_ROUTING_RESOURCE_URI,
      },
    },
    createEVRoutingHandler()
  );
}
