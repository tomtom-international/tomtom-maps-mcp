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
import {
  createAreaSearchHandler,
  createEVSearchHandler,
  createFuzzySearchHandler,
  createGeocodeHandler,
  createNearbySearchHandler,
  createPOICategoriesHandler,
  createPoiSearchHandler,
  createReverseGeocodeHandler,
  createSearchAlongRouteHandler,
} from "../handlers/searchHandler";
import { schemas } from "../schemas/index";
import { omittedUnlessGeometry } from "../schemas/shared/responseOptions";
import { PLACES_AND_ROUTES_APP, registerTomTomAppTool } from "./helpers/registerTomTomAppTool";

/**
 * Creates and registers search-related tools
 */
export function createSearchTools(server: McpServer): void {
  registerTomTomAppTool(
    server,
    {
      name: "tomtom-geocode",
      title: "TomTom Geocode",
      description: "Convert street addresses to coordinates.",
      inputSchema: schemas.tomtomGeocodeSearchSchema,
      app: PLACES_AND_ROUTES_APP,
    },
    createGeocodeHandler()
  );

  registerTomTomAppTool(
    server,
    {
      name: "tomtom-reverse-geocode",
      title: "TomTom Reverse Geocode",
      description: "Convert coordinates to addresses.",
      inputSchema: schemas.tomtomReverseGeocodeSearchSchema,
      app: PLACES_AND_ROUTES_APP,
    },
    createReverseGeocodeHandler()
  );

  registerTomTomAppTool(
    server,
    {
      name: "tomtom-fuzzy-search",
      title: "TomTom Fuzzy Search",
      description: "Typo-tolerant search for addresses, points of interest, and geographies.",
      inputSchema: schemas.tomtomFuzzySearchSchema,
      app: PLACES_AND_ROUTES_APP,
    },
    createFuzzySearchHandler()
  );

  registerTomTomAppTool(
    server,
    {
      name: "tomtom-poi-search",
      title: "TomTom POI Search",
      description:
        "Search for a specific business or POI by name, or browse an entire POI category. Best for finding a known place (e.g. 'Starbucks') or listing all businesses of a type (e.g. the 'ITALIAN_RESTAURANT' category code from tomtom-poi-categories). Supports optional location bias but does not constrain results to a strict geographic boundary — tomtom-area-search does that.",
      inputSchema: schemas.tomtomPOISearchSchema,
      app: PLACES_AND_ROUTES_APP,
    },
    createPoiSearchHandler()
  );

  registerTomTomAppTool(
    server,
    {
      name: "tomtom-nearby",
      title: "TomTom Nearby Search",
      description:
        "Find places of a kind close to a specific point. Best for 'what's around here?' queries when you have exact coordinates (lat/lon). Needs poiCategories, or a brand, fuel, connector or charging-power filter. Returns results sorted by distance. Use tomtom-area-search instead when the search area is a polygon or bounding box rather than a simple radius.",
      inputSchema: schemas.tomtomNearbySearchSchema,
      app: PLACES_AND_ROUTES_APP,
    },
    createNearbySearchHandler()
  );

  registerTomTomAppTool(
    server,
    {
      name: "tomtom-poi-categories",
      title: "TomTom POI Categories",
      description:
        "Look up POI category codes from natural language. The poiCategories parameter of the search tools accepts only codes returned by this tool. " +
        "Category codes are UPPER_SNAKE_CASE text strings (e.g. 'ITALIAN_RESTAURANT', 'PARKING_GARAGE'), not numeric IDs. " +
        "Workflow: (1) extract the user's intent as keywords (e.g. 'italian restaurants in Amsterdam' → filters: ['italian restaurant']); " +
        "(2) call this tool with those keywords in the filters parameter; " +
        "(3) pass the returned category codes in the poiCategories parameter of search tools (fuzzy-search, poi-search, nearby, area-search). " +
        "Guessed or hardcoded category codes are unreliable; this tool is the source of valid codes.",
      inputSchema: schemas.tomtomPOICategoriesSchema,
      app: PLACES_AND_ROUTES_APP,
      openWorldHint: false,
    },
    createPOICategoriesHandler()
  );

  registerTomTomAppTool(
    server,
    {
      name: "tomtom-area-search",
      title: "TomTom Area Search",
      description:
        "Find all POIs within a strict geographic boundary — polygon, bounding box, or circle. Use this when the search must be confined to a specific region (e.g. 'restaurants inside Westminster', 'hotels within this polygon'). Unlike tomtom-nearby (radius from a point) or tomtom-poi-search (location bias), this tool guarantees results are inside the defined geometry. " +
        omittedUnlessGeometry("The search area outline", "is"),
      inputSchema: schemas.tomtomAreaSearchSchema,
      app: PLACES_AND_ROUTES_APP,
    },
    createAreaSearchHandler()
  );

  registerTomTomAppTool(
    server,
    {
      name: "tomtom-ev-search",
      title: "TomTom EV Charging Search",
      description:
        "Find EV charging stations with their connector types and power levels. Results carry no real-time charger availability.",
      inputSchema: schemas.tomtomEvSearchSchema,
      app: PLACES_AND_ROUTES_APP,
    },
    createEVSearchHandler()
  );

  registerTomTomAppTool(
    server,
    {
      name: "tomtom-search-along-route",
      title: "TomTom Search Along Route",
      description:
        "Find points of interest (restaurants, gas stations, hotels, etc.) along a route corridor. Calculates the route between origin and destination, then searches for POIs within a configurable distance from the route. " +
        omittedUnlessGeometry("The route line", "is"),
      inputSchema: schemas.tomtomSearchAlongRouteSchema,
      app: PLACES_AND_ROUTES_APP,
    },
    createSearchAlongRouteHandler()
  );
}
