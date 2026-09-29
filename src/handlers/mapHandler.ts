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
import { logger } from "../utils/logger";
import { buildErrorResponse, type MCPResponseContent } from "./shared/responseTrimmer";

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
      const result = await renderDynamicMap(mapParams);

      const sourceNames = Object.keys(result.mapState.sources);
      const summary =
        sourceNames.length > 0
          ? `Dynamic map ready (${result.width}x${result.height}, layers: ${sourceNames.join(", ")})`
          : `Dynamic map ready (${result.width}x${result.height})`;

      // show_ui gates the interactive app: cache the state and hand the app its id.
      const meta = show_ui
        ? { show_ui: true, viz_id: await storeVizData(result.mapState) }
        : { show_ui: false };

      const content: MCPResponseContent[] = [
        { type: "text", text: summary },
        { type: "text", text: JSON.stringify({ _meta: meta }, null, 2) },
      ];
      return { content };
    } catch (error: unknown) {
      return buildErrorResponse(error, "Dynamic map generation");
    }
  };
}
