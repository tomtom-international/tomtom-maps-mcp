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
  trimRoutingResponse,
  trimReachableRangeResponse,
  buildCompressedResponse,
  Backend,
} from "./shared/responseTrimmer";

const BACKEND: Backend = "orbis";

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

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return {
          content: [{ text: JSON.stringify(response, null, 2), type: "text" as const }],
        };
      }

      // Trimmed for agent, compressed full data for Apps
      const trimmed = trimRoutingResponse(result, BACKEND);
      return buildCompressedResponse(trimmed, result, show_ui);
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
    logger.info(
      { waypoint_count: routingParams.waypoints.length },
      "🗺️ Multi-waypoint route calculation"
    );
    try {
      const result = await getMultiWaypointRoute(routingParams.waypoints, routingParams);
      logger.info("✅ Multi-waypoint route calculated");

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return {
          content: [{ text: JSON.stringify(response, null, 2), type: "text" as const }],
        };
      }

      // Trimmed for agent, compressed full data for Apps
      const trimmed = trimRoutingResponse(result, BACKEND);
      return buildCompressedResponse(trimmed, result, show_ui);
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
    const { show_ui = true, response_detail = "compact", ...rangeParams } = params;
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

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return {
          content: [{ text: JSON.stringify(response, null, 2), type: "text" as const }],
        };
      }

      // Trimmed for agent, compressed full data for Apps
      const trimmed = trimReachableRangeResponse(result, BACKEND);
      return buildCompressedResponse(trimmed, result, show_ui);
    } catch (error: any) {
      logger.error({ error: error.message }, "❌ Reachable range failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}
