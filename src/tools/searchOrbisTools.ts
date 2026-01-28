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

// tools/searchTools.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { schemas } from "../schemas/indexOrbis";
import {
  createGeocodeHandler,
  createReverseGeocodeHandler,
  createFuzzySearchHandler,
  createPoiSearchHandler,
  createNearbySearchHandler,
} from "../handlers/searchOrbisHandler";
import fs from "node:fs/promises";
import path from "node:path";
import {registerAppResource, RESOURCE_MIME_TYPE} from "@modelcontextprotocol/ext-apps/server";

const DIST_DIR = path.join(import.meta.dirname, "dist");

/**
 * Creates and registers search-related tools
 */
export function createSearchOrbisTools(server: McpServer): void {
  // Geocode tool
  server.registerTool(
    "tomtom-geocode",
    {
      title: "TomTom Geocode",
      description: "Convert street addresses to coordinates (does not support points of interest)",
      inputSchema: schemas.tomtomGeocodeSearchSchema as any,
      _meta: { backend: "orbis" },
    },
    createGeocodeHandler() as any
  );

  // Reverse geocode tool
  server.registerTool(
    "tomtom-reverse-geocode",
    {
      title: "TomTom Reverse Geocode",
      description: "Convert coordinates to addresses",
      inputSchema: schemas.tomtomReverseGeocodeSearchSchema as any,
      _meta: { backend: "orbis" },
    },
    createReverseGeocodeHandler() as any
  );

  // Fuzzy search tool
  server.registerTool(
    "tomtom-fuzzy-search",
    {
      title: "TomTom Fuzzy Search",
      description: "Typo-tolerant search for addresses, points of interest, and geographies",
      inputSchema: schemas.tomtomFuzzySearchSchema as any,
      _meta: { backend: "orbis" },
    },
    createFuzzySearchHandler() as any
  );

  // POI search tool
  server.registerTool(
    "tomtom-poi-search",
    {
      title: "TomTom POI Search",
      description: "Find specific business categories",
      inputSchema: schemas.tomtomPOISearchSchema as any,
      _meta: { backend: "orbis" },
    },
    createPoiSearchHandler() as any
  );

    const resourceUri = "ui://tomtom-poi-search/mcp-app.html";

    registerAppResource(
        server,
        resourceUri,
        resourceUri,
        { mimeType: RESOURCE_MIME_TYPE },
        async () => {
            const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");

            return {
                contents: [
                    {
                        uri: resourceUri,
                        mimeType: RESOURCE_MIME_TYPE,
                        text: html,
                        _meta: {
                            ui: {
                                csp: {
                                    connectDomains: [
                                        "https://api.tomtom.com",
                                        "https://*.api.tomtom.com",
                                        "https://unpkg.com",
                                    ],
                                    resourceDomains: [
                                        "https://unpkg.com",
                                    ],
                                },
                            },
                        },
                    },
                ],
            };
        },
    )

  // Nearby search tool
  server.registerTool(
    "tomtom-nearby",
    {
      title: "TomTom Nearby Search",
      description: "Discover services within a radius",
      inputSchema: schemas.tomtomNearbySearchSchema as any,
      _meta: { backend: "orbis" },
    },
    createNearbySearchHandler() as any
  );
}
