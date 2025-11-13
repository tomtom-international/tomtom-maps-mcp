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

// tools/mappingTools.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { schemas } from "../schemas/index";
import { createStaticMapHandler } from "../handlers/mapHandler";
import { createDynamicMapHandler } from "../handlers/dynamicMapHandler";
import { logger } from "../utils/logger";

/**
 * Creates and registers mapping-related tools
 */
export function createMapTools(server: McpServer): void {
  // Register static map tool (always available)
  server.tool(
    "tomtom-static-map", 
    "Generate custom map images from TomTom Maps with specified center coordinates, zoom levels, and style options", 
    schemas.tomtomMapSchema, 
    createStaticMapHandler()
  );
  
  // Register dynamic map tool only if ENABLE_DYNAMIC_MAPS is not explicitly set to "false"
  const enableDynamicMaps = process.env.ENABLE_DYNAMIC_MAPS === "true";
  
  if (enableDynamicMaps) {
    try {
      // Register the dynamic map tool
      server.tool(
        "tomtom-dynamic-map", 
        "Advanced map rendering with custom markers, routes, polygons, and traffic visualization using server-side rendering", 
        schemas.tomtomDynamicMapSchema, 
        createDynamicMapHandler()
      );
      logger.info("✅ Dynamic map tool registered successfully");
    } catch (error: any) {
      logger.warn(`⚠️ Dynamic map tool could not be registered: ${error.message}`);
      logger.info("ℹ️ To enable dynamic maps, make sure you have Node v22 and install @maplibre/maplibre-gl-native and canvas");
      logger.info("ℹ️ Set ENABLE_DYNAMIC_MAPS=false to disable this warning");
    }
  } else {
    logger.info("ℹ️ Dynamic maps are disabled (ENABLE_DYNAMIC_MAPS=false)");
  }
}
