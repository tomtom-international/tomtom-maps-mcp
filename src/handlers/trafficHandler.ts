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

import { getTrafficIncidents } from "../services/traffic/trafficService";
import type { TrafficIncidentsOptions, TrafficIncidentsParams } from "../services/traffic/types";
import { logger } from "../utils/logger";

// Handler factory function
export function createTrafficHandler() {
  return async (params: TrafficIncidentsParams) => {
    // Validate required parameters - return early to avoid locally caught exceptions
    if (!params.bbox && !params.query) {
      const errorMessage = "Either bbox or query parameter must be provided";
      logger.error({ error: errorMessage }, "❌ Traffic lookup failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMessage }) }],
        isError: true,
      };
    }

    if (!params.bbox) {
      const errorMessage = "Either 'bbox' or 'query' parameter must be provided";
      logger.error({ error: errorMessage }, "❌ Traffic lookup failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMessage }) }],
        isError: true,
      };
    }

    try {
      const options: TrafficIncidentsOptions = {
        language: params.language,
        maxResults: params.maxResults,
        categoryFilter: params.categoryFilter,
        timeValidityFilter: params.timeValidityFilter,
      };

      logger.info({ bbox: params.bbox }, "🚦 Traffic lookup");
      const result = await getTrafficIncidents(params.bbox, options);

      const count = result.incidents?.length || 0;
      logger.info({ count }, "✅ Traffic incidents found");

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, "❌ Traffic lookup failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMessage }) }],
        isError: true,
      };
    }
  };
}
