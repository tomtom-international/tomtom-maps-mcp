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
import { getRoute, getReachableRange } from "../services/routing/routingOrbisService";
import {
  trimRoutingResponse,
  trimReachableRangeResponse,
  buildCompressedResponse,
  Backend,
} from "./shared/responseTrimmer";
import type { Position } from "geojson";

const BACKEND: Backend = "orbis";

// Handler factory functions
export function createRoutingHandler() {
  return async (params: Record<string, unknown>) => {
    const { show_ui = true, response_detail = "compact", ...routingParams } = params;
    const locations = routingParams.locations as Position[];
    logger.info({ location_count: locations.length }, "🗺️ Route calculation");
    try {
      const result = await getRoute(locations, routingParams as Parameters<typeof getRoute>[1]);
      logger.info("✅ Route calculated successfully");

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return {
          content: [{ text: JSON.stringify(response, null, 2), type: "text" as const }],
        };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimRoutingResponse(result, BACKEND);
      return await buildCompressedResponse(trimmed, result, show_ui as boolean);
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

export function createReachableRangeHandler() {
  return async (params: Record<string, unknown>) => {
    const { show_ui = true, response_detail = "compact", ...rangeParams } = params;
    // Validate that at least one budget parameter is provided
    if (
      !rangeParams.timeBudgetInSec &&
      !rangeParams.distanceBudgetInMeters &&
      !rangeParams.chargeBudgetPercent &&
      !rangeParams.remainingChargeBudgetPercent &&
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

    const origin = rangeParams.origin as Position;
    logger.info({ origin: { lng: origin[0], lat: origin[1] } }, "🔄 Reachable range calculation");
    try {
      const result = await getReachableRange(
        origin,
        rangeParams as Parameters<typeof getReachableRange>[1]
      );
      logger.info("✅ Reachable range calculated");

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return {
          content: [{ text: JSON.stringify(response, null, 2), type: "text" as const }],
        };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimReachableRangeResponse(result, BACKEND);
      return await buildCompressedResponse(trimmed, result, show_ui as boolean);
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
