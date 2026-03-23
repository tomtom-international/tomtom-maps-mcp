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
 * Geometry/Area Search tool registration.
 * Uses TomTom Maps SDK geometrySearch().
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { tomtomAreaSearchSchema } from "../schemas/search/areaSearchOrbisSchema";
import { createAreaSearchHandler } from "../handlers/areaSearchOrbisHandler";
import { registerAppTool, RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";
import { registerAppResourceFromPath } from "./helpers/resourceRegistry";

const AREA_SEARCH_RESOURCE_URI = "ui://tomtom-search/area-search/app.html";

/**
 * Creates and registers Geometry/Area Search tool
 */
export async function createAreaSearchOrbisTools(server: McpServer): Promise<void> {
  // Register area search app resource
  await registerAppResourceFromPath(server, AREA_SEARCH_RESOURCE_URI, "search", "area-search");

  // Area Search tool with UI
  registerAppTool(
    server,
    "tomtom-area-search",
    {
      title: "TomTom Area Search",
      description:
        "Find all POIs within a strict geographic boundary — polygon, bounding box, or circle. Use this when the search must be confined to a specific region (e.g. 'restaurants inside Westminster', 'hotels within this polygon'). Unlike tomtom-nearby (radius from a point) or tomtom-poi-search (location bias), this tool guarantees results are inside the defined geometry.",
      inputSchema: tomtomAreaSearchSchema,
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
}
