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
import { logger } from "../utils/logger";
import { trimTrafficResponse, Backend } from "./shared/responseTrimmer";
import type { TrafficIncidentsOptions } from "../services/traffic/types";
import type { TrafficParams } from "../schemas/traffic/trafficSchema";

const BACKEND: Backend = "genesis";

/**
 * Helper function to get traffic incidents by location query or bounding box
 */
async function getTrafficByBbox(bbox?: string, options: TrafficIncidentsOptions = {}) {
  if (bbox) {
    return await getTrafficIncidents(bbox, options);
  }

  throw new Error("Either 'bbox' or 'query' parameter must be provided");
}

// Handler factory function
export function createTrafficHandler() {
  return async (params: TrafficParams) => {
    try {
      const {
        response_detail = "compact",
        bbox,
        language,
        maxResults,
        categoryFilter,
        timeValidityFilter,
      } = params;
      if (!bbox) {
        throw new Error("Either bbox or query parameter must be provided");
      }

      const options: TrafficIncidentsOptions = {
        language,
        maxResults,
        categoryFilter,
        timeValidityFilter,
      };

      logger.info({ bbox }, "Traffic lookup");
      const result = await getTrafficByBbox(bbox, options);

      // If full response requested, return without trimming
      if (response_detail === "full") {
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      }

      const trimmed = trimTrafficResponse(result, BACKEND);
      return { content: [{ type: "text" as const, text: JSON.stringify(trimmed, null, 2) }] };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "Traffic lookup failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}
