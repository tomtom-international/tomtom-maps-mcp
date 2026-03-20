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
import { trimTrafficResponse, Backend } from "./shared/responseTrimmer";

const BACKEND: Backend = "orbis";

/**
 * Helper function to get traffic incidents by location query or bounding box
 */
async function getTrafficByBbox(bbox?: string, options: any = {}) {
  if (bbox) {
    return await getTrafficIncidents(bbox, options);
  }

  throw new Error("Either 'bbox' or 'query' parameter must be provided");
}

// Handler factory function
export function createTrafficHandler() {
  return async (params: any) => {
    try {
      const { show_ui = true, response_detail = "compact", ...trafficParams } = params;
      if (!trafficParams.bbox && !trafficParams.query) {
        throw new Error("Either bbox or query parameter must be provided");
      }

      const options = {
        language: trafficParams.language,
        maxResults: trafficParams.maxResults,
        categoryFilter: trafficParams.categoryFilter,
        timeValidityFilter: trafficParams.timeValidityFilter,
      };

      logger.info({ bbox: trafficParams.bbox }, "🚦 Traffic lookup");
      const result = await getTrafficByBbox(trafficParams.bbox, options);

      const count = result.incidents?.length || 0;
      logger.info({ count }, "✅ Traffic incidents found");

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      }

      // Trimmed for agent context efficiency; app uses live SDK traffic modules
      const trimmed = trimTrafficResponse(result, BACKEND);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ ...(trimmed as object), _meta: { show_ui } }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      logger.error({ error: error.message }, "❌ Traffic lookup failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}
