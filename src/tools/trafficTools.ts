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

import { RESOURCE_URI_META_KEY, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
// tools/trafficTools.ts
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createTrafficHandler } from "../handlers/trafficHandler";
import { schemas } from "../schemas/index";
import { omittedUnlessGeometry } from "../schemas/shared/responseOptions";
import { registerAppResourceFromPath } from "./helpers/resourceRegistry";

// Resource URI for traffic MCP app
const TRAFFIC_INCIDENTS_RESOURCE_URI = "ui://tomtom-traffic/incidents/app.html";

/**
 * Creates and registers traffic-related tools
 */
export async function createTrafficTools(server: McpServer): Promise<RegisteredTool[]> {
  // Register traffic app resource
  await registerAppResourceFromPath(server, TRAFFIC_INCIDENTS_RESOURCE_URI, "traffic", "incidents");

  // Traffic incidents tool with UI
  const trafficTool = registerAppTool(
    server,
    "tomtom-traffic",
    {
      title: "TomTom Traffic",
      description:
        "Find traffic incidents in an area. The primary tool for questions about traffic, accidents, road closures, congestion, or dangerous road conditions. " +
        "Returns severity, description, delay and affected roads for each incident. " +
        omittedUnlessGeometry("Incident locations"),
      inputSchema: schemas.tomtomTrafficSchema,
      annotations: {
        title: "TomTom Traffic",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: {
        [RESOURCE_URI_META_KEY]: TRAFFIC_INCIDENTS_RESOURCE_URI,
      },
    },
    createTrafficHandler()
  );

  return [trafficTool];
}
