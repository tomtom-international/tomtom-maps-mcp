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

import { logger } from "../utils/logger";
import { renderDynamicMap, compressMapImage } from "../services/map/dynamicMapService";
import { storeVizData } from "../services/cache/vizCache";

/**
 * Handler factory function for dynamic map rendering
 */
export function createDynamicMapHandler() {
  return async (params: any) => {
    const { show_ui = true, detail = "compact", ...mapParams } = params;

    logger.info(
      { use_orbis: mapParams?.use_orbis ?? false, detail },
      "🗺️ Processing dynamic map request"
    );

    try {
      const result = await renderDynamicMap(mapParams);

      const originalSizeKB = (Buffer.from(result.base64, "base64").length / 1024).toFixed(2);
      logger.info(
        { width: result.width, height: result.height, size_kb: originalSizeKB },
        "✅ Dynamic map generated successfully"
      );

      // Determine image data based on detail level
      let imageBase64: string;
      let imageMimeType: string;

      if (detail === "full") {
        imageBase64 = result.base64;
        imageMimeType = result.contentType;
      } else {
        // compact mode: compress to under 1MB
        const compressed = await compressMapImage(result.base64);
        imageBase64 = compressed.base64;
        imageMimeType = compressed.contentType;
      }

      const finalSizeKB = (Buffer.from(imageBase64, "base64").length / 1024).toFixed(2);

      // Build response content array
      const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [
        {
          type: "text",
          text: `Dynamic map generated successfully (${result.width}x${result.height}, ${finalSizeKB}KB, detail: ${detail})`,
        },
        {
          type: "image",
          data: imageBase64,
          mimeType: imageMimeType,
        },
      ];

      // If show_ui is true and we have map state, cache it and add _meta
      if (show_ui && result.mapState) {
        const vizId = await storeVizData(result.mapState);
        content.push({
          type: "text",
          text: JSON.stringify({ _meta: { show_ui: true, viz_id: vizId } }, null, 2),
        });
        logger.debug({ viz_id: vizId }, "Cached map state for MCP app");
      } else {
        content.push({
          type: "text",
          text: JSON.stringify({ _meta: { show_ui: false } }, null, 2),
        });
      }

      return { content };
    } catch (error: any) {
      logger.error({ error: error.message }, "❌ Dynamic map generation failed");

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
