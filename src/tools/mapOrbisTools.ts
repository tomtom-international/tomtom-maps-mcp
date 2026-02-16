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
import { createDynamicMapHandler } from "../handlers/dynamicMapHandler";
import { schemas } from "../schemas/indexOrbis";

/**
 * Creates and registers mapping-related tools for TomTom Orbis Maps
 */
export function createMapOrbisTools(server: McpServer): void {
  // TomTom Orbis Maps only supports dynamic maps. Do NOT register the static-map tool for TomTom Orbis Maps.
  // Dynamic map: register the handler/schema but ensure use_orbis=true for all TomTom Orbis Maps calls
  const dynamicHandler = createDynamicMapHandler();
  server.registerTool(
    "tomtom-dynamic-map",
    {
      title: "TomTom Dynamic Map",
      description:
        "Advanced map rendering with custom markers, routes, polygons, and traffic visualization using server-side rendering",
      inputSchema: schemas.tomtomDynamicMapSchema,
      _meta: { backend: "tomtom-orbis-maps" },
    },
    async (params: any) => dynamicHandler({ ...params, use_orbis: true })
  );
}
