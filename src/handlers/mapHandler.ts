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

import type { DynamicMapParams } from "../schemas/map/dynamicMapSchema";
import { storeVizData } from "../services/cache/vizCache";
import { renderDynamicMap } from "../services/map/dynamicMapService";
import type { DynamicMapOptions } from "../services/map/dynamicMapTypes";
import { handleApiError } from "../utils/apiErrorHandler";
import { logger } from "../utils/logger";

/**
 * Handler factory function for dynamic map rendering.
 *
 * The map itself is drawn by the MCP app from the state built here; the server
 * renders no image. Clients without MCP app support get the summary text only.
 */
export function createDynamicMapHandler() {
  return async (params: DynamicMapParams) => {
    const { show_ui = true, ...mapParams } = params;

    logger.info({ show_ui }, "Processing dynamic map request");

    try {
      const result = await renderDynamicMap(mapParams as unknown as DynamicMapOptions);

      const sourceNames = Object.keys(result.mapState.sources);
      logger.info(
        { width: result.width, height: result.height, sources: sourceNames.length },
        "Dynamic map state generated successfully"
      );

      const summary =
        sourceNames.length > 0
          ? `Dynamic map ready (${result.width}x${result.height}, layers: ${sourceNames.join(", ")})`
          : `Dynamic map ready (${result.width}x${result.height})`;

      const content: Array<{ type: "text"; text: string }> = [
        { type: "text" as const, text: summary },
      ];

      // show_ui gates the interactive app: cache the state and hand the app its id.
      if (show_ui) {
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
      const formattedError = handleApiError(error, "Dynamic map generation");
      const message = formattedError.message;
      logger.error({ error: message }, "Dynamic map generation failed");

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
