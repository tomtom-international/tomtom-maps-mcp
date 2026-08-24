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
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createDynamicMapHandler } from "../handlers/mapHandler";
import { schemas } from "../schemas/index";
import type { DynamicMapParams } from "../schemas/map/dynamicMapSchema";
import { registerAppResourceFromPath } from "./helpers/resourceRegistry";

// Resource URI for dynamic map MCP app
const DYNAMIC_MAP_RESOURCE_URI = "ui://tomtom-map/dynamic-map/app.html";

/**
 * Creates and registers mapping-related tools for TomTom Maps
 */
export async function createMapTools(server: McpServer): Promise<void> {
  // Register dynamic map app resource
  await registerAppResourceFromPath(server, DYNAMIC_MAP_RESOURCE_URI, "map", "dynamic-map");

  const dynamicHandler = createDynamicMapHandler();
  registerAppTool(
    server,
    "tomtom-dynamic-map",
    {
      title: "TomTom Dynamic Map",
      description:
        "Render an interactive map with markers, drawn lines, polygons, and area overlays. " +
        "The map is drawn by the MCP app, so the visual requires a client that supports MCP apps. " +
        "Use this for MAP VISUALIZATION: showing locations on a map, highlighting areas, or combining multiple visual elements in one view. " +
        "Do NOT use this for: route calculations (use tomtom-routing), traffic incidents (use tomtom-traffic), or large-dataset visualization like heatmaps/clusters/choropleth (use tomtom-data-viz). " +
        "The optional routePlans parameter can calculate and draw routes on the map, but only use it when you need routes combined with other map elements (markers, polygons) in a single view.",
      inputSchema: schemas.tomtomDynamicMapSchema,
      annotations: {
        title: "TomTom Dynamic Map",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: {
        [RESOURCE_URI_META_KEY]: DYNAMIC_MAP_RESOURCE_URI,
      },
    },
    async (params: Record<string, unknown>) => dynamicHandler(params as DynamicMapParams)
  );
}
