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

import { getTrafficIncidents } from "../services/traffic/trafficOrbisService";
import { logger } from "../utils/logger";

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
      if (!params.bbox && !params.query) {
        throw new Error("Either bbox or query parameter must be provided");
      }

      const options = {
        language: params.language,
        maxResults: params.maxResults,
        categoryFilter: params.categoryFilter || params.incidentTypes,
        timeValidityFilter: params.timeFilter,
        t: params.t,
      };

      logger.info(`🚦 Traffic lookup: ${params.bbox ? `bbox: ${params.bbox}` : ""}`);
      const result = await getTrafficByBbox(params.bbox, options);

      const count = result.incidents?.length || 0;
      logger.info(`✅ Found ${count} traffic incident(s)`);

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error: any) {
      logger.error(JSON.stringify(error.message, null, 2));
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}
