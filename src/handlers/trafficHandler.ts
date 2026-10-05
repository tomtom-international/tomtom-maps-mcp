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

import type { TrafficParams } from "../schemas/traffic/trafficSchema";
import { toBBox } from "../services/shared/sdkInputs";
import { getTrafficIncidents } from "../services/traffic/trafficService";
import { IncorrectError } from "../types/types";
import { logger } from "../utils/logger";
import {
  buildErrorResponse,
  buildToolResponse,
  capTrafficIncidents,
  requestedTrafficFields,
  trimTrafficResponse,
} from "./shared/responseTrimmer";
import { incidentFeatures } from "./shared/geometryResponse";

export function createTrafficHandler() {
  return async (params: TrafficParams) => {
    try {
      const { show_ui = true, response_detail = "compact", bbox: bboxInput, ...options } = params;
      const bbox = toBBox(bboxInput);
      if (!bbox) throw new IncorrectError("bbox parameter must be provided", {});

      logger.info({ bbox }, "🚦 Traffic lookup");
      const result = await getTrafficIncidents(bbox, options);

      const count = result.incidents?.length || 0;
      logger.info({ count }, "✅ Traffic incidents found");

      // Agent-facing incidents are capped; the map UI gets the uncapped result.
      const requested = requestedTrafficFields(options.timeValidityFilter);
      return buildToolResponse(
        capTrafficIncidents(result, options.maxResults),
        (capped) => trimTrafficResponse(capped, requested),
        {
          showUI: show_ui,
          responseDetail: response_detail,
          cached: result,
          geometry: incidentFeatures,
        }
      );
    } catch (error: unknown) {
      return buildErrorResponse(error, "Traffic lookup");
    }
  };
}
