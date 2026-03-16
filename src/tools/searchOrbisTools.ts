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
  createPOICategoriesHandler,
} from "../handlers/searchOrbisHandler";
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
  await registerAppResourceFromPath(
    server,
    REVERSE_GEOCODE_RESOURCE_URI,
    "search",
    "reverse-geocode"
  );
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
      inputSchema: schemas.tomtomGeocodeSearchSchema,
      annotations: {
        title: "TomTom Geocode",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: {
        backend: "tomtom-orbis-maps",
        [RESOURCE_URI_META_KEY]: GEOCODE_RESOURCE_URI,
      },
    },
    createGeocodeHandler()
  );

  // Reverse geocode tool with UI
  registerAppTool(
    server,
    "tomtom-reverse-geocode",
    {
      title: "TomTom Reverse Geocode",
      description: "Convert coordinates to addresses with interactive map UI",
      inputSchema: schemas.tomtomReverseGeocodeSearchSchema,
      annotations: {
        title: "TomTom Reverse Geocode",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: {
        backend: "tomtom-orbis-maps",
        [RESOURCE_URI_META_KEY]: REVERSE_GEOCODE_RESOURCE_URI,
      },
    },
    createReverseGeocodeHandler()
  );

  // Fuzzy search tool with UI
  registerAppTool(
    server,
    "tomtom-fuzzy-search",
    {
      title: "TomTom Fuzzy Search",
      description:
        "Typo-tolerant search for addresses, points of interest, and geographies with interactive map UI",
      inputSchema: schemas.tomtomFuzzySearchSchema,
      annotations: {
        title: "TomTom Fuzzy Search",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: {
        backend: "tomtom-orbis-maps",
        [RESOURCE_URI_META_KEY]: FUZZY_SEARCH_RESOURCE_URI,
      },
    },
    createFuzzySearchHandler()
  );

  // POI search tool with UI
  registerAppTool(
    server,
    "tomtom-poi-search",
    {
      title: "TomTom POI Search",
      description:
        "Search for a specific business or POI by name, or browse an entire POI category. Best for finding a known place (e.g. 'Starbucks') or listing all businesses of a type (e.g. category 7315 for restaurants). Supports optional location bias but does NOT constrain results to a strict geographic boundary — use tomtom-area-search for that.",
      inputSchema: schemas.tomtomPOISearchSchema,
      annotations: {
        title: "TomTom POI Search",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: {
        backend: "tomtom-orbis-maps",
        [RESOURCE_URI_META_KEY]: POI_SEARCH_RESOURCE_URI,
      },
    },
    createPoiSearchHandler()
  );

  // Nearby search tool with UI
  registerAppTool(
    server,
    "tomtom-nearby",
    {
      title: "TomTom Nearby Search",
      description:
        "Find places close to a specific point. Best for 'what's around here?' queries when you have exact coordinates (lat/lon). Returns results sorted by distance. Use tomtom-area-search instead when the search area is a polygon or bounding box rather than a simple radius.",
      inputSchema: schemas.tomtomNearbySearchSchema,
      annotations: {
        title: "TomTom Nearby Search",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: {
        backend: "tomtom-orbis-maps",
        [RESOURCE_URI_META_KEY]: NEARBY_SEARCH_RESOURCE_URI,
      },
    },
    createNearbySearchHandler()
  );

  // POI categories lookup tool (no UI)
  registerAppTool(
    server,
    "tomtom-poi-categories",
    {
      title: "TomTom POI Categories",
      description:
        "Browse and search available POI (Point of Interest) category codes. Use this tool to discover valid category codes before filtering search results with poiCategories parameter in other search tools (fuzzy-search, poi-search, nearby, area-search). Supports keyword filtering — e.g. 'gym', 'restaurant', 'parking'.",
      inputSchema: schemas.tomtomPOICategoriesSchema,
      annotations: {
        title: "TomTom POI Categories",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        backend: "tomtom-orbis-maps",
      },
    },
    createPOICategoriesHandler()
  );
}
