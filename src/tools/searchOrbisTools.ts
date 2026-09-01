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
  createAreaSearchHandler,
  createEVSearchHandler,
  createSearchAlongRouteHandler,
} from "../handlers/searchOrbisHandler";
import { registerAppTool, RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";
import { registerAppResourceFromPath } from "./helpers/resourceRegistry";

// Resource URIs for search MCP apps
const GEOCODE_RESOURCE_URI = "ui://tomtom-search/geocode/app.html";
const REVERSE_GEOCODE_RESOURCE_URI = "ui://tomtom-search/reverse-geocode/app.html";
const FUZZY_SEARCH_RESOURCE_URI = "ui://tomtom-search/fuzzy-search/app.html";
const POI_SEARCH_RESOURCE_URI = "ui://tomtom-search/poi-search/app.html";
const NEARBY_SEARCH_RESOURCE_URI = "ui://tomtom-search/nearby-search/app.html";
const POI_CATEGORIES_RESOURCE_URI = "ui://tomtom-search/poi-categories/app.html";
const AREA_SEARCH_RESOURCE_URI = "ui://tomtom-search/area-search/app.html";
const EV_SEARCH_RESOURCE_URI = "ui://tomtom-search/ev-search/app.html";
const SEARCH_ALONG_ROUTE_RESOURCE_URI = "ui://tomtom-search/search-along-route/app.html";

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
  await registerAppResourceFromPath(
    server,
    POI_CATEGORIES_RESOURCE_URI,
    "search",
    "poi-categories"
  );

  // Geocode tool with UI
  registerAppTool(
    server,
    "tomtom-geocode",
    {
      title: "TomTom Geocode",
      description: "Convert street addresses to coordinates (does not support POI names)",
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
      description: "Convert coordinates to addresses",
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
        "Typo-tolerant search for addresses, points of interest, and geographies",
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
        "Search for a specific business or POI by name, or browse an entire POI category. Supports optional location bias.",
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
      description: "Find places close to a specific point, sorted by distance.",
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
        "Look up POI category codes from natural language. " +
        "Category codes are UPPER_SNAKE_CASE text strings (e.g. 'ITALIAN_RESTAURANT', 'PARKING_GARAGE'), NOT numeric IDs. " +
        "Workflow: (1) Extract the user's intent as keywords (e.g. 'italian restaurant'). " +
        "(2) Call this tool with those keywords in the filters parameter. " +
        "(3) Use the returned codes in the poiCategories parameter of search tools.",
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
        [RESOURCE_URI_META_KEY]: POI_CATEGORIES_RESOURCE_URI,
      },
    },
    createPOICategoriesHandler()
  );

  // Area Search tool with UI
  await registerAppResourceFromPath(server, AREA_SEARCH_RESOURCE_URI, "search", "area-search");
  registerAppTool(
    server,
    "tomtom-area-search",
    {
      title: "TomTom Area Search",
      description:
        "Find all POIs within a strict geographic boundary — polygon, bounding box, or circle. Guarantees results are inside the defined geometry.",
      inputSchema: schemas.tomtomAreaSearchSchema,
      annotations: {
        title: "TomTom Area Search",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: {
        backend: "tomtom-orbis-maps",
        [RESOURCE_URI_META_KEY]: AREA_SEARCH_RESOURCE_URI,
      },
    },
    createAreaSearchHandler()
  );

  // EV Charging Station Search tool with UI
  await registerAppResourceFromPath(server, EV_SEARCH_RESOURCE_URI, "search", "ev-search");
  registerAppTool(
    server,
    "tomtom-ev-search",
    {
      title: "TomTom EV Charging Search",
      description:
        "Find EV charging stations with real-time availability, connector types, and power levels.",
      inputSchema: schemas.tomtomEvSearchSchema,
      annotations: {
        title: "TomTom EV Charging Search",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: {
        backend: "tomtom-orbis-maps",
        [RESOURCE_URI_META_KEY]: EV_SEARCH_RESOURCE_URI,
      },
    },
    createEVSearchHandler()
  );

  // Search Along Route tool with UI
  await registerAppResourceFromPath(
    server,
    SEARCH_ALONG_ROUTE_RESOURCE_URI,
    "search",
    "search-along-route"
  );
  registerAppTool(
    server,
    "tomtom-search-along-route",
    {
      title: "TomTom Search Along Route",
      description:
        "Find points of interest along a route corridor between origin and destination.",
      inputSchema: schemas.tomtomSearchAlongRouteSchema,
      annotations: {
        title: "TomTom Search Along Route",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: {
        backend: "tomtom-orbis-maps",
        [RESOURCE_URI_META_KEY]: SEARCH_ALONG_ROUTE_RESOURCE_URI,
      },
    },
    createSearchAlongRouteHandler()
  );
}
