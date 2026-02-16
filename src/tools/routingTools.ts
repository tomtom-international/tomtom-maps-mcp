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
      description: "Calculate optimal routes between locations",
      inputSchema: schemas.tomtomRoutingSchema as any,
      annotations: {
        title: "TomTom Routing",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: { backend: "tomtom-maps" },
    },
    createRoutingHandler() as any
  );

  // Multi-waypoint routing tool
  server.registerTool(
    "tomtom-waypoint-routing",
    {
      title: "TomTom Waypoint Routing",
      description: "Multi-stop route planning Routing API",
      inputSchema: schemas.tomtomWaypointRoutingSchema as any,
      annotations: {
        title: "TomTom Waypoint Routing",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: { backend: "tomtom-maps" },
    },
    createWaypointRoutingHandler() as any
  );

  // Reachable range tool
  server.registerTool(
    "tomtom-reachable-range",
    {
      title: "TomTom Reachable Range",
      description: "Determine the area reachable within a specified time or driving distance",
      inputSchema: schemas.tomtomReachableRangeSchema as any,
      annotations: {
        title: "TomTom Reachable Range",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: { backend: "tomtom-maps" },
    },
    createReachableRangeHandler() as any
  );
}
