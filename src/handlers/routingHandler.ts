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

import type { RoutingParams } from "../schemas/routing/routingSchema";
import { getRoute } from "../services/routing/routingService";
import { logger } from "../utils/logger";
import {
  buildErrorResponse,
  buildToolResponse,
  trimRoutingResponse,
} from "./shared/responseTrimmer";
import { routeFeaturesFromGeoJSON } from "./shared/geometryResponse";

export function createRoutingHandler() {
  return async (params: RoutingParams) => {
    const { show_ui = false, response_detail = "compact", ...routingParams } = params;
    const locations = routingParams.locations;
    logger.info({ location_count: locations.length }, "🗺️ Route calculation");
    try {
      const result = await getRoute(locations, routingParams);
      logger.info("✅ Route calculated successfully");

      return buildToolResponse(result, trimRoutingResponse, {
        showUI: show_ui,
        responseDetail: response_detail,
        geometry: routeFeaturesFromGeoJSON,
      });
    } catch (error: unknown) {
      return buildErrorResponse(error, "Route calculation");
    }
  };
}
