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
} from "../services/routing/routingService";
import { trimRoutingResponse, trimReachableRangeResponse, Backend } from "./shared/responseTrimmer";
import type { Coordinates, RouteOptions, ReachableRangeOptions } from "../services/routing/types";

const BACKEND: Backend = "genesis";

// Handler factory functions
export function createRoutingHandler() {
  return async (params: Record<string, unknown>) => {
    const { response_detail = "compact", ...routingParams } = params;
    const origin = routingParams.origin as Coordinates;
    const destination = routingParams.destination as Coordinates;
    logger.info(
      {
        origin: { lat: origin.lat, lon: origin.lon },
        destination: { lat: destination.lat, lon: destination.lon },
      },
      "🗺️ Route calculation"
    );
    try {
      const result = await getRoute(origin, destination, routingParams as RouteOptions);
      logger.info("✅ Route calculated successfully");

      // If full response requested, return without trimming
      if (response_detail === "full") {
        return {
          content: [{ text: JSON.stringify(result, null, 2), type: "text" as const }],
        };
      }

      // Return trimmed data for Agent efficiency
      const trimmed = trimRoutingResponse(result, BACKEND);

      return {
        content: [
          {
            text: JSON.stringify(trimmed, null, 2),
            type: "text" as const,
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "❌ Routing failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}

export function createWaypointRoutingHandler() {
  return async (params: Record<string, unknown>) => {
    const { response_detail = "compact", ...routingParams } = params;
    const waypoints = routingParams.waypoints as Coordinates[];
    logger.info({ waypoint_count: waypoints.length }, "🗺️ Multi-waypoint route calculation");
    try {
      const result = await getMultiWaypointRoute(waypoints, routingParams as RouteOptions);
      logger.info("✅ Multi-waypoint route calculated");

      // If full response requested, return without trimming
      if (response_detail === "full") {
        return {
          content: [{ text: JSON.stringify(result, null, 2), type: "text" as const }],
        };
      }

      // Return trimmed data for Agent efficiency
      const trimmed = trimRoutingResponse(result, BACKEND);

      return {
        content: [
          {
            text: JSON.stringify(trimmed, null, 2),
            type: "text" as const,
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "❌ Multi-waypoint routing failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}

export function createReachableRangeHandler() {
  return async (params: Record<string, unknown>) => {
    const { response_detail = "compact", ...rangeParams } = params;
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

    const origin = rangeParams.origin as Coordinates;
    logger.info({ origin: { lat: origin.lat, lon: origin.lon } }, "🔄 Reachable range calculation");
    try {
      const result = await getReachableRange(origin, rangeParams as ReachableRangeOptions);
      logger.info("✅ Reachable range calculated");

      // If full response requested, return without trimming
      if (response_detail === "full") {
        return {
          content: [{ text: JSON.stringify(result, null, 2), type: "text" as const }],
        };
      }

      // Return trimmed data for Agent efficiency
      const trimmed = trimReachableRangeResponse(result, BACKEND);
      return {
        content: [
          {
            text: JSON.stringify(trimmed, null, 2),
            type: "text" as const,
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "❌ Reachable range failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}
