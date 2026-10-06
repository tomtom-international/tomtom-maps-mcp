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
import {
  createEVRoutingHandler,
  createReachableRangeHandler,
  createRoutingHandler,
} from "../handlers/routingHandler";
import { schemas } from "../schemas/index";
import { omittedUnlessGeometry } from "../schemas/shared/responseOptions";
import { registerTomTomAppTool } from "./helpers/registerTomTomAppTool";

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
      app: "routing/route-planner",
    },
    createRoutingHandler()
  );

  registerTomTomAppTool(
    server,
    {
      name: "tomtom-reachable-range",
      title: "TomTom Reachable Range",
      description:
        "Determine the area reachable within a time, distance, fuel, energy or charge budget. " +
        "The engine and consumption inputs apply only to the fuel, energy and charge budgets. " +
        omittedUnlessGeometry("The boundary polygon", "is"),
      inputSchema: schemas.tomtomReachableRangeSchema,
      app: "routing/reachable-range",
    },
    createReachableRangeHandler()
  );

  registerTomTomAppTool(
    server,
    {
      name: "tomtom-ev-routing",
      title: "TomTom EV Route Planner",
      description:
        "Plan long-distance electric vehicle routes with automatic charging stop optimization. Calculates optimal charging stops based on battery state, vehicle model, and charging connector compatibility. " +
        omittedUnlessGeometry("The route line and charging stop locations"),
      inputSchema: schemas.tomtomEvRoutingSchema,
      app: "routing/ev-routing",
    },
    createEVRoutingHandler()
  );
}
