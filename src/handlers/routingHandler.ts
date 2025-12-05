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

// Handler factory functions
export function createRoutingHandler() {
  return async (params: any) => {
    logger.info(
      `🗺️ Route: (${params.origin.lat},${params.origin.lon}) → (${params.destination.lat},${params.destination.lon})`
    );
    try {
      const result = await getRoute(params.origin, params.destination, params);
      logger.info(`✅ Route calculated successfully`);
      return {
        content: [
          {
            text: JSON.stringify(result, null, 2),
            type: "text" as const,
          },
        ],
      };
    } catch (error: any) {
      logger.error(`❌ Routing failed: ${error.message}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}

export function createWaypointRoutingHandler() {
  return async (params: any) => {
    logger.info(`🗺️ Multi-waypoint route: ${params.waypoints.length} waypoints`);
    try {
      const result = await getMultiWaypointRoute(params.waypoints, params);
      logger.info(`✅ Multi-waypoint route calculated`);
      return {
        content: [
          {
            text: JSON.stringify(result, null, 2),
            type: "text" as const,
          },
        ],
      };
    } catch (error: any) {
      logger.error(`❌ Multi-waypoint routing failed: ${error.message}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}

export function createReachableRangeHandler() {
  return async (params: any) => {
    // Validate that at least one budget parameter is provided
    if (
      !params.timeBudgetInSec &&
      !params.distanceBudgetInMeters &&
      !params.energyBudgetInkWh &&
      !params.fuelBudgetInLiters
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

    logger.info(`🔄 Reachable range from (${params.origin.lat}, ${params.origin.lon})`);
    try {
      const result = await getReachableRange(params.origin, params);
      logger.info(`✅ Reachable range calculated`);
      return {
        content: [
          {
            text: JSON.stringify(result, null, 2),
            type: "text" as const,
          },
        ],
      };
    } catch (error: any) {
      logger.error(`❌ Reachable range failed: ${error.message}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}
