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
  createWaypointRoutingHandler,
  createReachableRangeHandler,
} from "../handlers/routingOrbisHandler";
import { registerAppTool, RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";
import { registerAppResourceFromPath } from "./helpers/resourceRegistry";

// Resource URIs for routing MCP apps
const ROUTE_PLANNER_RESOURCE_URI = "ui://tomtom-routing/route-planner/app.html";
const WAYPOINT_ROUTING_RESOURCE_URI = "ui://tomtom-routing/waypoint-routing/app.html";
const REACHABLE_RANGE_RESOURCE_URI = "ui://tomtom-routing/reachable-range/app.html";

/**
 * Creates and registers routing-related tools
 */
export async function createRoutingOrbisTools(server: McpServer): Promise<void> {
  // Register all routing app resources
  await registerAppResourceFromPath(server, ROUTE_PLANNER_RESOURCE_URI, "routing", "route-planner");
  await registerAppResourceFromPath(
    server,
    WAYPOINT_ROUTING_RESOURCE_URI,
    "routing",
    "waypoint-routing"
  );
  await registerAppResourceFromPath(
    server,
    REACHABLE_RANGE_RESOURCE_URI,
    "routing",
    "reachable-range"
  );

  // Basic routing tool with UI
  registerAppTool(
    server,
    "tomtom-routing",
    {
      title: "TomTom Routing",
      description:
        "Calculate optimal routes between two locations. Use this tool FIRST when the user asks about directions, routes, travel time, or distance between places (e.g. 'route from Amsterdam to Berlin', 'how long to drive from A to B'). Returns turn-by-turn directions, distance, travel time, and an interactive map. For multi-stop routes with 3+ waypoints, use tomtom-waypoint-routing instead. For visualizing multiple routes or combining routes with markers/polygons on a single map image, use tomtom-dynamic-map.",
      inputSchema: schemas.tomtomRoutingSchema as any,
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
    createRoutingHandler() as any
  );

  // Multi-waypoint routing tool with UI
  registerAppTool(
    server,
    "tomtom-waypoint-routing",
    {
      title: "TomTom Waypoint Routing",
      description:
        "Plan multi-stop routes through 3 or more waypoints with interactive map UI. Use when the user needs to visit multiple locations in sequence (e.g. 'route from A to B via C and D'). Returns optimized turn-by-turn directions, total distance, and travel time. For simple A-to-B routes, use tomtom-routing instead.",
      inputSchema: schemas.tomtomWaypointRoutingSchema as any,
      annotations: {
        title: "TomTom Waypoint Routing",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: {
        backend: "tomtom-orbis-maps",
        [RESOURCE_URI_META_KEY]: WAYPOINT_ROUTING_RESOURCE_URI,
      },
    },
    createWaypointRoutingHandler() as any
  );

  // Reachable range tool with UI
  registerAppTool(
    server,
    "tomtom-reachable-range",
    {
      title: "TomTom Reachable Range",
      description:
        "Determine the area reachable within a specified time or driving distance with interactive map UI",
      inputSchema: schemas.tomtomReachableRangeSchema as any,
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
    createReachableRangeHandler() as any
  );
}
