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
import { schemas } from "../schemas/index";
import { createStaticMapHandler } from "../handlers/mapHandler";
import { createDynamicMapHandler } from "../handlers/dynamicMapHandler";

/**
 * Creates and registers mapping-related tools for TomTom Maps (Genesis)
 */
export function createMapTools(server: McpServer): void {
  // Register static map tool (always available)
  server.registerTool(
    "tomtom-static-map",
    {
      title: "TomTom Static Map",
      description:
        "Generate custom map images from TomTom Maps with specified center coordinates, zoom levels, and style options",
      inputSchema: schemas.tomtomMapSchema,
      annotations: {
        title: "TomTom Static Map",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: { backend: "tomtom-maps" },
    },
    createStaticMapHandler()
  );

  // Register dynamic map tool (Genesis raster tiles + skia-canvas, no MCP app UI)
  const dynamicHandler = createDynamicMapHandler();
  server.registerTool(
    "tomtom-dynamic-map",
    {
      title: "TomTom Dynamic Map",
      description:
        "Render a custom map image with markers, drawn lines, polygons, and area overlays using server-side rendering. " +
        "Use this for MAP VISUALIZATION: showing locations on a map, highlighting areas, or combining multiple visual elements in one view. " +
        "Do NOT use this for: route calculations (use tomtom-routing), or traffic incidents (use tomtom-traffic). " +
        "The optional routePlans parameter can calculate and draw routes on the map, but only use it when you need routes combined with other map elements (markers, polygons) in a single image.",
      inputSchema: schemas.tomtomDynamicMapSchema,
      annotations: {
        title: "TomTom Dynamic Map",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: { backend: "tomtom-maps" },
    },
    dynamicHandler
  );
}
