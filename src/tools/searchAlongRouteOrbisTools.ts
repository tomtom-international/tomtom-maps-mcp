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
 * Search Along Route tool registration.
 * Uses TomTom Maps SDK calculateRoute() + geometrySearch().
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { tomtomSearchAlongRouteSchema } from "../schemas/search/searchAlongRouteOrbisSchema";
import { createSearchAlongRouteHandler } from "../handlers/searchAlongRouteOrbisHandler";
import { registerAppTool, RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";
import { registerAppResourceFromPath } from "./helpers/resourceRegistry";

const SEARCH_ALONG_ROUTE_RESOURCE_URI = "ui://tomtom-search/search-along-route/app.html";

/**
 * Creates and registers Search Along Route tool
 */
export async function createSearchAlongRouteOrbisTools(server: McpServer): Promise<void> {
  // Register search along route app resource
  await registerAppResourceFromPath(
    server,
    SEARCH_ALONG_ROUTE_RESOURCE_URI,
    "search",
    "search-along-route"
  );

  // Search Along Route tool with UI
  registerAppTool(
    server,
    "tomtom-search-along-route",
    {
      title: "TomTom Search Along Route",
      description:
        "Find points of interest (restaurants, gas stations, hotels, etc.) along a route corridor. Calculates the route between origin and destination, then searches for POIs within a configurable distance from the route. Uses TomTom Maps SDK.",
      inputSchema: tomtomSearchAlongRouteSchema,
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
