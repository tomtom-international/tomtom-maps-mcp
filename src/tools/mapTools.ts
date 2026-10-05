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
import { createDynamicMapHandler } from "../handlers/mapHandler";
import { schemas } from "../schemas/index";
import type { DynamicMapParams } from "../schemas/map/dynamicMapSchema";
import { registerTomTomAppTool } from "./helpers/registerTomTomAppTool";

/**
 * Creates and registers mapping-related tools for TomTom Maps
 */
export function createMapTools(server: McpServer): void {
  const dynamicHandler = createDynamicMapHandler();
  registerTomTomAppTool(
    server,
    {
      name: "tomtom-dynamic-map",
      title: "TomTom Dynamic Map",
      description:
        "Render an interactive map with markers, drawn lines, polygons, and area overlays. " +
        "The map is drawn by the MCP app, so the visual requires a client that supports MCP apps. " +
        "The caller gets back only a summary (the view, marker positions, route distance and time), never route lines or area outlines; " +
        "tools whose response_detail offers 'geometry' return those as GeoJSON. " +
        "Intended for map visualization: showing locations on a map, highlighting areas, or combining multiple visual elements in one view. " +
        "Not intended for route calculations (tomtom-routing), traffic incidents (tomtom-traffic), or large-dataset visualization like heatmaps/clusters/choropleth (tomtom-data-viz). " +
        "The optional routePlans parameter can calculate and draw routes on the map; it is meant for routes combined with other map elements (markers, polygons) in a single view.",
      inputSchema: schemas.tomtomDynamicMapSchema,
      app: "map/dynamic-map",
    },
    async (params: Record<string, unknown>) => dynamicHandler(params as DynamicMapParams)
  );
}
