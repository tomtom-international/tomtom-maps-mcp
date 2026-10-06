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
 * BYOD Data Visualization tool registration.
 * Registers the tomtom-data-viz tool and its associated App resource.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createDataVizHandler } from "../handlers/dataVizHandler";
import { tomtomDataVizSchema } from "../schemas/dataViz/dataVizSchema";
import type { WithoutApps } from "../clientApps";
import { registerTomTomAppTool } from "./helpers/registerTomTomAppTool";

/**
 * Creates and registers the BYOD Data Visualization tool
 */
export function createDataVizTools(server: McpServer): WithoutApps {
  return registerTomTomAppTool(
    server,
    {
      name: "tomtom-data-viz",
      title: "TomTom Data Visualization",
      description:
        "Visualize custom GeoJSON data on a TomTom basemap. " +
        "The map is drawn by the MCP app, so the visual requires a client that supports MCP apps; the caller gets back only a summary. " +
        "Intended for large datasets, heatmaps, cluster maps, choropleth maps, or GeoJSON data (from a URL or inline) rendered on a map. " +
        "Supports markers, heatmaps, clusters, lines, polygon fills, and choropleth maps. " +
        "Provide data via HTTPS URL or inline GeoJSON. Multiple layers can be overlaid in a single call. " +
        "Point features are automatically enriched with TomTom address data when clicked (reverse geocode). " +
        "Placing a few specific markers, routes, or polygons is handled by tomtom-dynamic-map; " +
        "route calculations (directions, travel time) are handled by tomtom-routing.",
      inputSchema: tomtomDataVizSchema,
      app: "data-viz/byod",
      uiOnly: true,
    },
    createDataVizHandler()
  );
}
