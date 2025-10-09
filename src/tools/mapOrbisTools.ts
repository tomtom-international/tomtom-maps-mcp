/*
 * Copyright (C) 2025 TomTom NV
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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { schemas } from "../schemas/indexOrbis";
import { createDynamicMapHandler } from "../handlers/dynamicMapHandler";

/**
 * Creates and registers mapping-related tools for Orbis
 */
export function createMapOrbisTools(server: McpServer): void {
  // Orbis only supports dynamic maps. Do NOT register the static-map tool for Orbis.
  // Dynamic map: register the handler/schema but ensure use_orbis=true for all Orbis calls
  const dynamicHandler = createDynamicMapHandler();
  server.tool(
    "tomtom-dynamic-map", 
    "Advanced map rendering with custom markers, routes, polygons, and traffic visualization using server-side rendering", 
    schemas.tomtomDynamicMapSchema, 
    async (params: any) => dynamicHandler({ ...params, use_orbis: true })
  );
}
