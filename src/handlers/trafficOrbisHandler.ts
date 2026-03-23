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

import { getTrafficIncidents } from "../services/traffic/trafficOrbisService";
import { logger } from "../utils/logger";
import { trimTrafficResponse, buildCompressedResponse, Backend } from "./shared/responseTrimmer";
import type { BBox } from "@tomtom-org/maps-sdk/core";

const BACKEND: Backend = "orbis";

/**
 * Helper function to get traffic incidents by bounding box
 */
async function getTrafficByBbox(bbox?: BBox, options: Record<string, unknown> = {}) {
  if (bbox) {
    return await getTrafficIncidents(bbox, options);
  }

  throw new Error("bbox parameter must be provided");
}

// Handler factory function
export function createTrafficHandler() {
  return async (params: Record<string, unknown>) => {
    try {
      const { show_ui = true, response_detail = "compact", ...trafficParams } = params;
      if (!trafficParams.bbox) {
        throw new Error("bbox parameter must be provided");
      }

      const options = {
        language: trafficParams.language,
        maxResults: trafficParams.maxResults,
        categoryFilter: trafficParams.categoryFilter,
        timeValidityFilter: trafficParams.timeValidityFilter,
      };

      logger.info({ bbox: trafficParams.bbox }, "🚦 Traffic lookup");
      const result = await getTrafficByBbox(trafficParams.bbox as BBox, options);

      const count = result.incidents?.length || 0;
      logger.info({ count }, "✅ Traffic incidents found");

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimTrafficResponse(result, BACKEND);
      return await buildCompressedResponse(trimmed, result, show_ui as boolean);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "❌ Traffic lookup failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}
