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
import type { DynamicMapOptions } from "../services/map/dynamicMapTypes";
import type { DynamicMapParams } from "../schemas/map/dynamicMapSchema";

/**
 * Handler factory function for Orbis dynamic map rendering
 * (Orbis raster tiles + skia-canvas)
 */
export function createDynamicOrbisMapHandler() {
  return async (params: DynamicMapParams) => {
    const { show_ui = true, detail = "compact", ...mapParams } = params;

    logger.info({ use_orbis: true, detail }, "🗺️ Processing Orbis dynamic map request");

    try {
      const result = await renderDynamicMap({
        ...(mapParams as unknown as DynamicMapOptions),
        use_orbis: true,
      });

      const originalSizeKB = (Buffer.from(result.base64, "base64").length / 1024).toFixed(2);
      logger.info(
        { width: result.width, height: result.height, size_kb: originalSizeKB },
        "✅ Orbis dynamic map generated successfully"
      );

      // Determine image data based on detail level
      let imageBase64: string;
      let imageMimeType: string;

      if (detail === "full") {
        imageBase64 = result.base64;
        imageMimeType = result.contentType;
      } else {
        // compact mode: compress to under 1MB
        try {
          const compressed = await compressMapImage(result.base64);
          imageBase64 = compressed.base64;
          imageMimeType = compressed.contentType;
        } catch (compressError: unknown) {
          const compressMsg =
            compressError instanceof Error ? compressError.message : String(compressError);
          logger.warn(
            { error: compressMsg },
            "⚠️ Image compression failed, falling back to original"
          );
          imageBase64 = result.base64;
          imageMimeType = result.contentType;
        }
      }

      const finalSizeKB = (Buffer.from(imageBase64, "base64").length / 1024).toFixed(2);

      // Build response content array
      type ContentItem =
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string };
      const content: ContentItem[] = [
        {
          type: "text" as const,
          text: `Dynamic map generated successfully (${result.width}x${result.height}, ${finalSizeKB}KB, detail: ${detail})`,
        },
        {
          type: "image" as const,
          data: imageBase64,
          mimeType: imageMimeType,
        },
      ];

      // If show_ui is true and we have map state, cache it and add _meta
      if (show_ui && result.mapState) {
        const vizId = await storeVizData(result.mapState);
        content.push({
          type: "text" as const,
          text: JSON.stringify({ _meta: { show_ui: true, viz_id: vizId } }, null, 2),
        });
        logger.debug({ viz_id: vizId }, "Cached map state for MCP app");
      } else {
        content.push({
          type: "text" as const,
          text: JSON.stringify({ _meta: { show_ui: false } }, null, 2),
        });
      }

      return { content };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "❌ Orbis dynamic map generation failed");

      if (message.includes("Dynamic map dependencies not available")) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: message,
                  help: "Install skia-canvas to enable this feature: npm install skia-canvas",
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
            text: JSON.stringify({ error: message }),
          },
        ],
        isError: true,
      };
    }
  };
}
