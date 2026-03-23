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
import { schemas } from "../schemas/index";
import {
  createRoutingHandler,
  createWaypointRoutingHandler,
  createReachableRangeHandler,
} from "../handlers/routingHandler";

/**
 * Creates and registers routing-related tools
 */
export function createRoutingTools(server: McpServer): void {
  // Basic routing tool
  server.registerTool(
    "tomtom-routing",
    {
      title: "TomTom Routing",
      description:
        "Calculate optimal routes between two locations. Use this tool FIRST when the user asks about directions, routes, travel time, or distance between places (e.g. 'route from Amsterdam to Berlin', 'how long to drive from A to B'). Returns turn-by-turn directions, distance, travel time, and a map image. For multi-stop routes with 3+ waypoints, use tomtom-waypoint-routing instead. For visualizing multiple routes or combining routes with markers/polygons on a single map image, use tomtom-dynamic-map.",
      inputSchema: schemas.tomtomRoutingSchema,
      annotations: {
        title: "TomTom Routing",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: { backend: "tomtom-maps" },
    },
    createRoutingHandler()
  );

  // Multi-waypoint routing tool
  server.registerTool(
    "tomtom-waypoint-routing",
    {
      title: "TomTom Waypoint Routing",
      description:
        "Plan multi-stop routes through 3 or more waypoints. Use when the user needs to visit multiple locations in sequence (e.g. 'route from A to B via C and D'). Returns optimized turn-by-turn directions, total distance, and travel time. For simple A-to-B routes, use tomtom-routing instead.",
      inputSchema: schemas.tomtomWaypointRoutingSchema,
      annotations: {
        title: "TomTom Waypoint Routing",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: { backend: "tomtom-maps" },
    },
    createWaypointRoutingHandler()
  );

  // Reachable range tool
  server.registerTool(
    "tomtom-reachable-range",
    {
      title: "TomTom Reachable Range",
      description: "Determine the area reachable within a specified time or driving distance",
      inputSchema: schemas.tomtomReachableRangeSchema,
      annotations: {
        title: "TomTom Reachable Range",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: { backend: "tomtom-maps" },
    },
    createReachableRangeHandler()
  );
}
