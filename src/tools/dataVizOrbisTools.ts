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
 * BYOD Data Visualization tool registration (Orbis only).
 * Registers the tomtom-data-viz tool and its associated App resource.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { tomtomDataVizSchema } from "../schemas/dataViz/dataVizSchema";
import { createDataVizHandler } from "../handlers/dataVizHandler";
import { registerAppTool, RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";
import { registerAppResourceFromPath } from "./helpers/resourceRegistry";

const DATA_VIZ_RESOURCE_URI = "ui://tomtom-data-viz/byod/app.html";

/**
 * Creates and registers the BYOD Data Visualization tool
 */
export async function createDataVizOrbisTools(server: McpServer): Promise<void> {
  // Register the App resource (HTML file)
  await registerAppResourceFromPath(server, DATA_VIZ_RESOURCE_URI, "data-viz", "byod");

  // Register the tool with UI
  registerAppTool(
    server,
    "tomtom-data-viz",
    {
      title: "TomTom Data Visualization",
      description:
        "Visualize custom GeoJSON data on an interactive TomTom basemap. " +
        "Use this for LARGE DATASETS, heatmaps, cluster maps, choropleth maps, or when you have GeoJSON data (from a URL or inline) to render on a map. " +
        "Supports markers, heatmaps, clusters, lines, polygon fills, and choropleth maps. " +
        "Provide data via URL or inline GeoJSON. Multiple layers can be overlaid in a single call. " +
        "Point features are automatically enriched with TomTom address data when clicked (reverse geocode). " +
        "For placing a few specific markers, routes, or polygons, use tomtom-dynamic-map instead. " +
        "For route calculations (directions, travel time), use tomtom-routing.",
      inputSchema: tomtomDataVizSchema as any,
      annotations: {
        title: "TomTom Data Visualization",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: {
        backend: "tomtom-orbis-maps",
        [RESOURCE_URI_META_KEY]: DATA_VIZ_RESOURCE_URI,
      },
    },
    createDataVizHandler() as any
  );
}
