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

import {
  getMultiWaypointRoute,
  getReachableRange,
  getRoute,
} from "../services/routing/routingOrbisService";
import type {
  ReachableRangeParamsOrbis,
  RoutingParamsOrbis,
  WaypointRoutingParamsOrbis,
} from "../services/routing/types";
import { logger } from "../utils/logger";

// Handler factory functions
export function createRoutingHandler() {
  return async (params: RoutingParamsOrbis) => {
    logger.info(
      {
        origin: { lat: params.origin.lat, lon: params.origin.lon },
        destination: { lat: params.destination.lat, lon: params.destination.lon },
      },
      "🗺️ Route calculation"
    );
    try {
      const result = await getRoute(params.origin, params.destination, params);
      logger.info("✅ Route calculated successfully");
      return {
        content: [
          {
            text: JSON.stringify(result, null, 2),
            type: "text" as const,
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, "❌ Routing failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMessage }) }],
        isError: true,
      };
    }
  };
}

export function createWaypointRoutingHandler() {
  return async (params: WaypointRoutingParamsOrbis) => {
    logger.info({ waypoint_count: params.waypoints.length }, "🗺️ Multi-waypoint route calculation");
    try {
      const result = await getMultiWaypointRoute(params.waypoints, params);
      logger.info("✅ Multi-waypoint route calculated");
      return {
        content: [
          {
            text: JSON.stringify(result, null, 2),
            type: "text" as const,
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, "❌ Multi-waypoint routing failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMessage }) }],
        isError: true,
      };
    }
  };
}

export function createReachableRangeHandler() {
  return async (params: ReachableRangeParamsOrbis) => {
    // Validate that at least one budget parameter is provided - return early to avoid locally caught exceptions
    if (
      !params.timeBudgetInSec &&
      !params.distanceBudgetInMeters &&
      !params.energyBudgetInkWh &&
      !params.fuelBudgetInLiters
    ) {
      const errorMessage =
        "At least one budget parameter (time, distance, energy, or fuel) must be provided";
      logger.error({ error: errorMessage }, "❌ Reachable range failed");
      return {
        content: [
          {
            text: JSON.stringify({ error: errorMessage }),
            type: "text" as const,
          },
        ],
        isError: true,
      };
    }

    logger.info(
      { origin: { lat: params.origin.lat, lon: params.origin.lon } },
      "🔄 Reachable range calculation"
    );
    try {
      const result = await getReachableRange(params.origin, params);
      logger.info("✅ Reachable range calculated");
      return {
        content: [
          {
            text: JSON.stringify(result, null, 2),
            type: "text" as const,
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, "❌ Reachable range failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMessage }) }],
        isError: true,
      };
    }
  };
}
