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
  createSearchVisualizationDataHandler,
} from "../handlers/searchOrbisHandler";
import { z } from "zod";
import { registerAppTool, RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";
import { registerAppResourceFromPath } from "./helpers/resourceRegistry";

// Resource URIs for search MCP apps
const GEOCODE_RESOURCE_URI = "ui://tomtom-search/geocode/app.html";
const REVERSE_GEOCODE_RESOURCE_URI = "ui://tomtom-search/reverse-geocode/app.html";
const FUZZY_SEARCH_RESOURCE_URI = "ui://tomtom-search/fuzzy-search/app.html";
const POI_SEARCH_RESOURCE_URI = "ui://tomtom-search/poi-search/app.html";
const NEARBY_SEARCH_RESOURCE_URI = "ui://tomtom-search/nearby-search/app.html";

/**
 * Creates and registers search-related tools
 */
export async function createSearchOrbisTools(server: McpServer): Promise<void> {
  // Register all search app resources
  await registerAppResourceFromPath(server, GEOCODE_RESOURCE_URI, "search", "geocode");
  await registerAppResourceFromPath(server, REVERSE_GEOCODE_RESOURCE_URI, "search", "reverse-geocode");
  await registerAppResourceFromPath(server, FUZZY_SEARCH_RESOURCE_URI, "search", "fuzzy-search");
  await registerAppResourceFromPath(server, POI_SEARCH_RESOURCE_URI, "search", "poi-search");
  await registerAppResourceFromPath(server, NEARBY_SEARCH_RESOURCE_URI, "search", "nearby-search");

  // Geocode tool with UI
  registerAppTool(
    server,
    "tomtom-geocode",
    {
      title: "TomTom Geocode",
      description: "Convert street addresses to coordinates with interactive map UI",
      inputSchema: schemas.tomtomGeocodeSearchSchema as any,
      _meta: {
        backend: "orbis",
        [RESOURCE_URI_META_KEY]: GEOCODE_RESOURCE_URI,
      },
    },
    createGeocodeHandler() as any
  );

  // Reverse geocode tool with UI
  registerAppTool(
    server,
    "tomtom-reverse-geocode",
    {
      title: "TomTom Reverse Geocode",
      description: "Convert coordinates to addresses with interactive map UI",
      inputSchema: schemas.tomtomReverseGeocodeSearchSchema as any,
      _meta: {
        backend: "orbis",
        [RESOURCE_URI_META_KEY]: REVERSE_GEOCODE_RESOURCE_URI,
      },
    },
    createReverseGeocodeHandler() as any
  );

  // Fuzzy search tool with UI
  registerAppTool(
    server,
    "tomtom-fuzzy-search",
    {
      title: "TomTom Fuzzy Search",
      description: "Typo-tolerant search for addresses, points of interest, and geographies with interactive map UI",
      inputSchema: schemas.tomtomFuzzySearchSchema as any,
      _meta: {
        backend: "orbis",
        [RESOURCE_URI_META_KEY]: FUZZY_SEARCH_RESOURCE_URI,
      },
    },
    createFuzzySearchHandler() as any
  );

  // POI search tool with UI
  registerAppTool(
    server,
    "tomtom-poi-search",
    {
      title: "TomTom POI Search",
      description: "Find specific business categories with interactive map UI",
      inputSchema: schemas.tomtomPOISearchSchema as any,
      _meta: {
        backend: "orbis",
        [RESOURCE_URI_META_KEY]: POI_SEARCH_RESOURCE_URI,
      },
    },
    createPoiSearchHandler() as any
  );

  // Nearby search tool with UI
  registerAppTool(
    server,
    "tomtom-nearby",
    {
      title: "TomTom Nearby Search",
      description: "Discover services within a radius with interactive map UI",
      inputSchema: schemas.tomtomNearbySearchSchema as any,
      _meta: {
        backend: "orbis",
        [RESOURCE_URI_META_KEY]: NEARBY_SEARCH_RESOURCE_URI,
      },
    },
    createNearbySearchHandler() as any
  );

  // Visualization data tool for search - HIDDEN from Agent, only callable by App
  // This allows Apps to fetch full search data for rendering while Agent gets trimmed data
  registerAppTool(
    server,
    "tomtom-get-search-visualization-data",
    {
      title: "Get Search Visualization Data",
      description: "Fetch full search visualization data for map rendering (App-only)",
      inputSchema: {
        visualizationId: z.string().describe("The visualization ID from the search response"),
      },
      _meta: {
        backend: "orbis",
        ui: {
          resourceUri: GEOCODE_RESOURCE_URI, // Can be fetched from any search app
          visibility: ["app"], // Hidden from Agent, only callable by App
        },
      },
    },
    createSearchVisualizationDataHandler() as any
  );
}
