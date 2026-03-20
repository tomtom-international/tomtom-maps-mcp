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
import { schemas } from "../schemas/index";
import { createTrafficHandler } from "../handlers/trafficHandler";

/**
 * Creates and registers traffic-related tools
 */
export function createTrafficTools(server: McpServer): void {
  server.registerTool(
    "tomtom-traffic",
    {
      title: "TomTom Traffic",
      description:
        "Find and display traffic incidents in an area. Use this tool FIRST when the user asks about traffic, accidents, road closures, congestion, or dangerous road conditions. " +
        "Returns detailed incident data including severity, description, delay, and affected roads. " +
        "Do NOT use tomtom-dynamic-map to plot traffic incidents as markers — this tool provides complete traffic incident data.",
      inputSchema: schemas.tomtomTrafficSchema as any,
      annotations: {
        title: "TomTom Traffic",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: { backend: "tomtom-maps" },
    },
    createTrafficHandler() as any
  );
}
