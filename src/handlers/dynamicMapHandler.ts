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

import { logger } from "../utils/logger";
import { renderDynamicMap } from "../services/map/dynamicMapService";
import { z } from "zod";

/**
 * Handler factory function for dynamic map rendering
 */
export function createDynamicMapHandler() {
  return async (params: any) => {
    logger.info(`🗺️ Processing dynamic map request`);
    logger.info(`use_orbis: ${params?.use_orbis ?? false}`);

    try {
      const result = await renderDynamicMap(params);

      logger.info(
        `✅ Dynamic map generated successfully: ${result.width}x${result.height} (${(Buffer.from(result.base64, "base64").length / 1024).toFixed(2)} KB)`
      );

      return {
        content: [
          {
            type: "image" as const,
            data: result.base64,
            mimeType: result.contentType,
          },
        ],
      };
    } catch (error: any) {
      logger.error(`❌ Dynamic map generation failed: ${error.message}`);

      // Check if it's a dependency issue and provide helpful guidance
      if (error.message.includes("Dynamic map dependencies not available")) {
        const helpMessage = `Dynamic map dependencies are not installed.

To enable dynamic maps, install the required dependencies:
npm install @maplibre/maplibre-gl-native canvas

Note: These packages require native compilation and may need additional system dependencies.

Once installed, restart the MCP server to use the dynamic map functionality.`;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: error.message,
                  help: helpMessage,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: error.message }),
          },
        ],
        isError: true,
      };
    }
  };
}
