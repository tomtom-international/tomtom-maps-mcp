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
import {
  generateVisualizationId,
  cacheVisualizationData,
  getVisualizationData,
  trimTrafficResponse,
} from "./shared/visualizationCache";

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

      // If full response requested, return without trimming
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      }

      // Cache full data for App visualization, return trimmed for Agent
      const visualizationId = generateVisualizationId();
      cacheVisualizationData(visualizationId, result);

      const trimmed = trimTrafficResponse(result);
      const response = { ...trimmed, _meta: { show_ui, visualizationId } };
      return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
    } catch (error: any) {
      logger.error({ error: error.message }, "❌ Traffic lookup failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}

/**
 * Handler for fetching full traffic visualization data.
 * This tool is hidden from the Agent (visibility: ["app"]) and only callable by the App.
 */
export function createTrafficVisualizationDataHandler() {
  return async (params: { visualizationId: string }) => {
    const { visualizationId } = params;
    logger.info({ visualizationId }, "📊 Fetching traffic visualization data");

    const data = getVisualizationData(visualizationId);

    if (!data) {
      logger.warn({ visualizationId }, "⚠️ Traffic visualization data not found or expired");
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: "Visualization data not found or expired" }),
          },
        ],
        isError: true,
      };
    }

    logger.info("✅ Traffic visualization data retrieved");
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  };
}
