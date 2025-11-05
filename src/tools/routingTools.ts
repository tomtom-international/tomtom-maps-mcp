/*
 * Copyright (C) 2025 TomTom NV
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
  server.tool(
    "tomtom-routing", 
    "Calculate optimal routes between locations",
    schemas.tomtomRoutingSchema, 
    createRoutingHandler()
  );

  // Multi-waypoint routing tool
  server.tool(
    "tomtom-waypoint-routing",
    "Multi-stop route planning Routing API",
    schemas.tomtomWaypointRoutingSchema,
    createWaypointRoutingHandler()
  );
  
  // Reachable range tool
  server.tool(
    "tomtom-reachable-range",
    "Determine the area reachable within a specified time or driving distance",
    schemas.tomtomReachableRangeSchema,
    createReachableRangeHandler()
  );
}
