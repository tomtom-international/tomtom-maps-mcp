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
import {
  getRoute,
  getMultiWaypointRoute,
  getReachableRange,
} from "../services/routing/routingOrbisService";
import {
  generateVisualizationId,
  cacheVisualizationData,
  getVisualizationData,
  trimRoutingResponse,
} from "./shared/visualizationCache";

// Handler factory functions
export function createRoutingHandler() {
  return async (params: any) => {
    const { show_ui = true, response_detail = "compact", ...routingParams } = params;
    logger.info(
      {
        origin: { lat: routingParams.origin.lat, lon: routingParams.origin.lon },
        destination: { lat: routingParams.destination.lat, lon: routingParams.destination.lon },
      },
      "🗺️ Route calculation"
    );
    try {
      const result = await getRoute(routingParams.origin, routingParams.destination, routingParams);
      logger.info("✅ Route calculated successfully");

      // If full response requested, return without trimming
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return {
          content: [{ text: JSON.stringify(response, null, 2), type: "text" as const }],
        };
      }

      // Cache full data for App visualization, return trimmed for Agent
      const visualizationId = generateVisualizationId();
      cacheVisualizationData(visualizationId, result);

      // Trim the response for Agent (removes points[] arrays)
      const trimmed = trimRoutingResponse(result);

      // Add metadata for App to fetch full data
      const response = {
        ...trimmed,
        _meta: {
          show_ui,
          visualizationId, // App uses this to fetch full data
        },
      };

      return {
        content: [
          {
            text: JSON.stringify(response, null, 2),
            type: "text" as const,
          },
        ],
      };
    } catch (error: any) {
      logger.error({ error: error.message }, "❌ Routing failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}

export function createWaypointRoutingHandler() {
  return async (params: any) => {
    const { show_ui = true, response_detail = "compact", ...routingParams } = params;
    logger.info({ waypoint_count: routingParams.waypoints.length }, "🗺️ Multi-waypoint route calculation");
    try {
      const result = await getMultiWaypointRoute(routingParams.waypoints, routingParams);
      logger.info("✅ Multi-waypoint route calculated");

      // If full response requested, return without trimming
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return {
          content: [{ text: JSON.stringify(response, null, 2), type: "text" as const }],
        };
      }

      // Cache full data for App visualization, return trimmed for Agent
      const visualizationId = generateVisualizationId();
      cacheVisualizationData(visualizationId, result);

      const trimmed = trimRoutingResponse(result);
      const response = {
        ...trimmed,
        _meta: {
          show_ui,
          visualizationId,
        },
      };

      return {
        content: [
          {
            text: JSON.stringify(response, null, 2),
            type: "text" as const,
          },
        ],
      };
    } catch (error: any) {
      logger.error({ error: error.message }, "❌ Multi-waypoint routing failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}

export function createReachableRangeHandler() {
  return async (params: any) => {
    const { show_ui = true, ...rangeParams } = params;
    // Validate that at least one budget parameter is provided
    if (
      !rangeParams.timeBudgetInSec &&
      !rangeParams.distanceBudgetInMeters &&
      !rangeParams.energyBudgetInkWh &&
      !rangeParams.fuelBudgetInLiters
    ) {
      return {
        content: [
          {
            text: "Error: At least one budget parameter (time, distance, energy, or fuel) must be provided",
            type: "text" as const,
          },
        ],
        isError: true,
      };
    }

    logger.info(
      { origin: { lat: rangeParams.origin.lat, lon: rangeParams.origin.lon } },
      "🔄 Reachable range calculation"
    );
    try {
      const result = await getReachableRange(rangeParams.origin, rangeParams);
      logger.info("✅ Reachable range calculated");
      // Include show_ui flag in response for App to handle widget visibility
      const response = { ...result, _meta: { show_ui } };
      return {
        content: [
          {
            text: JSON.stringify(response, null, 2),
            type: "text" as const,
          },
        ],
      };
    } catch (error: any) {
      logger.error({ error: error.message }, "❌ Reachable range failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}

/**
 * Handler for fetching full visualization data.
 * This tool is hidden from the Agent (visibility: ["app"]) and only callable by the App.
 */
export function createVisualizationDataHandler() {
  return async (params: { visualizationId: string }) => {
    const { visualizationId } = params;
    logger.info({ visualizationId }, "📊 Fetching visualization data");

    const data = getVisualizationData(visualizationId);

    if (!data) {
      logger.warn({ visualizationId }, "⚠️ Visualization data not found or expired");
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

    logger.info("✅ Visualization data retrieved");
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
