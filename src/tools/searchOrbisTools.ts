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
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createFuzzySearchHandler,
  createGeocodeHandler,
  createNearbySearchHandler,
  createPoiSearchHandler,
  createReverseGeocodeHandler,
} from "../handlers/searchOrbisHandler";
import { schemas } from "../schemas/indexOrbis";

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
      inputSchema: schemas.tomtomGeocodeSearchSchema,
      _meta: { backend: "tomtom-orbis-maps" },
    },
    createGeocodeHandler()
  );

  // Reverse geocode tool
  server.registerTool(
    "tomtom-reverse-geocode",
    {
      title: "TomTom Reverse Geocode",
      description: "Convert coordinates to addresses",
      inputSchema: schemas.tomtomReverseGeocodeSearchSchema,
      _meta: { backend: "tomtom-orbis-maps" },
    },
    createReverseGeocodeHandler()
  );

  // Fuzzy search tool
  server.registerTool(
    "tomtom-fuzzy-search",
    {
      title: "TomTom Fuzzy Search",
      description: "Typo-tolerant search for addresses, points of interest, and geographies",
      inputSchema: schemas.tomtomFuzzySearchSchema,
      _meta: { backend: "tomtom-orbis-maps" },
    },
    createFuzzySearchHandler()
  );

  // POI search tool
  server.registerTool(
    "tomtom-poi-search",
    {
      title: "TomTom POI Search",
      description: "Find specific business categories",
      inputSchema: schemas.tomtomPOISearchSchema,
      _meta: { backend: "tomtom-orbis-maps" },
    },
    createPoiSearchHandler()
  );

  // Nearby search tool
  server.registerTool(
    "tomtom-nearby",
    {
      title: "TomTom Nearby Search",
      description: "Discover services within a radius",
      inputSchema: schemas.tomtomNearbySearchSchema,
      _meta: { backend: "tomtom-orbis-maps" },
    },
    createNearbySearchHandler()
  );
}
