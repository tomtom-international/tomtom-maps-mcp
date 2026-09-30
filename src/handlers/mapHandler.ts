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
import { renderDynamicMap } from "../services/map/dynamicMapService";
import { logger } from "../utils/logger";
import { buildCompressedResponse, buildErrorResponse } from "./shared/responseTrimmer";

/**
 * Handler factory function for dynamic map rendering.
 *
 * The map itself is drawn by the MCP app from the state built here; the server
 * renders no image. The agent gets a summary of what the map shows, which is
 * all a client without MCP app support receives.
 */
export function createDynamicMapHandler() {
  return async (params: DynamicMapParams) => {
    const { show_ui = true, ...mapParams } = params;

    logger.info({ show_ui }, "Processing dynamic map request");

    try {
      const { summary, mapState } = await renderDynamicMap(mapParams);
      return await buildCompressedResponse(summary, mapState, show_ui);
    } catch (error: unknown) {
      return buildErrorResponse(error, "Dynamic map generation");
    }
  };
}
