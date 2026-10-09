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
import { createRoutingHandler } from "../handlers/routingHandler";
import { schemas } from "../schemas/index";
import { omittedUnlessGeometry } from "../schemas/shared/responseOptions";
import { PLACES_AND_ROUTES_APP, registerTomTomAppTool } from "./helpers/registerTomTomAppTool";

/**
 * Creates and registers routing-related tools
 */
export function createRoutingTools(server: McpServer): void {
  registerTomTomAppTool(
    server,
    {
      name: "tomtom-routing",
      title: "TomTom Routing",
      description:
        "Calculate optimal routes through an ordered list of locations [origin, ...stops, destination]. The primary tool for directions, routes, travel time, or distance between places — whether a simple A-to-B or a multi-stop itinerary (e.g. 'route from Amsterdam to Berlin', 'drive from A to B via C and D'). Returns distance, travel time and traffic delay, with a summary per leg. Turn-by-turn instructions are not available. " +
        omittedUnlessGeometry("Route polylines"),
      inputSchema: schemas.tomtomRoutingSchema,
      app: PLACES_AND_ROUTES_APP,
    },
    createRoutingHandler()
  );
}
