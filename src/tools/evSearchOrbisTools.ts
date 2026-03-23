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
 * EV Charging Station Search tool registration.
 * Uses TomTom Maps SDK search() + getPlacesWithEVAvailability() directly.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { tomtomEvSearchSchema } from "../schemas/search/evSearchOrbisSchema";
import { createEVSearchHandler } from "../handlers/evSearchOrbisHandler";
import { registerAppTool, RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";
import { registerAppResourceFromPath } from "./helpers/resourceRegistry";

const EV_SEARCH_RESOURCE_URI = "ui://tomtom-search/ev-search/app.html";

/**
 * Creates and registers EV Charging Station Search tool
 */
export async function createEVSearchOrbisTools(server: McpServer): Promise<void> {
  // Register EV search app resource
  await registerAppResourceFromPath(server, EV_SEARCH_RESOURCE_URI, "search", "ev-search");

  // EV Charging Station Search tool with UI
  registerAppTool(
    server,
    "tomtom-ev-search",
    {
      title: "TomTom EV Charging Search",
      description:
        "Find EV charging stations with real-time availability, connector types, and power levels. Uses TomTom Maps SDK for enriched results with charger status (available/occupied/out-of-service).",
      inputSchema: tomtomEvSearchSchema,
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
}
