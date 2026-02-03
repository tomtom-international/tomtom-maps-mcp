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

// tools/trafficTools.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { schemas } from "../schemas/indexOrbis";
import { createTrafficHandler, createTrafficVisualizationDataHandler } from "../handlers/trafficOrbisHandler";
import { z } from "zod";
import { registerAppTool, RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";
import { registerAppResourceFromPath } from "./helpers/resourceRegistry";

// Resource URI for traffic MCP app
const TRAFFIC_INCIDENTS_RESOURCE_URI = "ui://tomtom-traffic/incidents/app.html";

/**
 * Creates and registers traffic-related tools
 */
export async function createTrafficOrbisTools(server: McpServer): Promise<void> {
  // Register traffic app resource
  await registerAppResourceFromPath(server, TRAFFIC_INCIDENTS_RESOURCE_URI, "traffic", "incidents");

  // Traffic incidents tool with UI
  registerAppTool(
    server,
    "tomtom-traffic",
    {
      title: "TomTom Traffic",
      description: "Look up traffic incidents in an area with interactive map UI (incidents, dangerous conditions, closures, etc.)",
      inputSchema: schemas.tomtomTrafficSchema as any,
      _meta: {
        backend: "orbis",
        [RESOURCE_URI_META_KEY]: TRAFFIC_INCIDENTS_RESOURCE_URI,
      },
    },
    createTrafficHandler() as any
  );

  // Visualization data tool for traffic - HIDDEN from Agent, only callable by App
  // This allows Apps to fetch full traffic data for rendering while Agent gets trimmed data
  registerAppTool(
    server,
    "tomtom-get-traffic-visualization-data",
    {
      title: "Get Traffic Visualization Data",
      description: "Fetch full traffic visualization data for map rendering (App-only)",
      inputSchema: {
        visualizationId: z.string().describe("The visualization ID from the traffic response"),
      },
      _meta: {
        backend: "orbis",
        ui: {
          resourceUri: TRAFFIC_INCIDENTS_RESOURCE_URI,
          visibility: ["app"], // Hidden from Agent, only callable by App
        },
      },
    },
    createTrafficVisualizationDataHandler() as any
  );
}
