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
 *
 * Long Distance EV Routing tool registration.
 * Uses TomTom Maps SDK calculateRoute() with electric vehicle parameters.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { tomtomEvRoutingSchema } from "../schemas/routing/routingOrbisSchema";
import { createEVRoutingHandler } from "../handlers/evRoutingOrbisHandler";
import { registerAppTool, RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";
import { registerAppResourceFromPath } from "./helpers/resourceRegistry";

const EV_ROUTING_RESOURCE_URI = "ui://tomtom-routing/ev-routing/app.html";

/**
 * Creates and registers Long Distance EV Routing tool
 */
export async function createEVRoutingOrbisTools(server: McpServer): Promise<void> {
  // Register EV routing app resource
  await registerAppResourceFromPath(server, EV_ROUTING_RESOURCE_URI, "routing", "ev-routing");

  // EV Routing tool with UI
  registerAppTool(
    server,
    "tomtom-ev-routing",
    {
      title: "TomTom EV Route Planner",
      description:
        "Plan long-distance electric vehicle routes with automatic charging stop optimization. Calculates optimal charging stops based on battery state, vehicle model, and charging connector compatibility. Uses TomTom Maps SDK.",
      inputSchema: tomtomEvRoutingSchema,
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
