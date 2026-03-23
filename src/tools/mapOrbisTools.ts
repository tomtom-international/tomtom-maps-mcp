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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { schemas } from "../schemas/indexOrbis";
import { createDynamicOrbisMapHandler } from "../handlers/dynamicOrbisMapHandler";
import { registerAppTool, RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";
import { registerAppResourceFromPath } from "./helpers/resourceRegistry";

// Resource URI for dynamic map MCP app
const DYNAMIC_MAP_RESOURCE_URI = "ui://tomtom-map/dynamic-map/app.html";

/**
 * Creates and registers mapping-related tools for TomTom Orbis Maps
 */
export async function createMapOrbisTools(server: McpServer): Promise<void> {
  // Register dynamic map app resource
  await registerAppResourceFromPath(server, DYNAMIC_MAP_RESOURCE_URI, "map", "dynamic-map");

  // TomTom Orbis Maps only supports dynamic maps. Do NOT register the static-map tool for TomTom Orbis Maps.
  // Dynamic map: register the handler/schema but ensure use_orbis=true for all TomTom Orbis Maps calls
  const dynamicHandler = createDynamicOrbisMapHandler();
  registerAppTool(
    server,
    "tomtom-dynamic-map",
    {
      title: "TomTom Dynamic Map",
      description:
        "Render a custom map image with markers, drawn lines, polygons, and area overlays — with interactive map UI. " +
        "Use this for MAP VISUALIZATION: showing locations on a map, highlighting areas, or combining multiple visual elements in one view. " +
        "Do NOT use this for: route calculations (use tomtom-routing), traffic incidents (use tomtom-traffic), or large-dataset visualization like heatmaps/clusters/choropleth (use tomtom-data-viz). " +
        "The optional routePlans parameter can calculate and draw routes on the map, but only use it when you need routes combined with other map elements (markers, polygons) in a single image.",
      inputSchema: schemas.tomtomDynamicMapSchema,
      annotations: {
        title: "TomTom Dynamic Map",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: {
        backend: "tomtom-orbis-maps",
        [RESOURCE_URI_META_KEY]: DYNAMIC_MAP_RESOURCE_URI,
      },
    },
    async (params: Record<string, unknown>) => dynamicHandler({ ...params, use_orbis: true })
  );
}
