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
 *
 * What remains of the search executors after the phase-4 collapse.
 *
 * Seven moved into `discover-places.ts` as modes of one tool. The two left are
 * genuinely their own task rather than a variant of "find places": reverse
 * geocoding (the opposite direction) and the POI category lookup (now optional,
 * since `discover-places` resolves natural language itself).
 */

import type {
  PoiCategoriesParams,
  ReverseGeocodeSearchParams,
} from "../../schemas/search/searchSchema";
import { fetchPOICategories, reverseGeocode } from "../../services/search/searchService";
import { logger } from "../../utils/logger";
import {
  buildErrorResponse,
  buildToolResponse,
  requestedSearchFields,
  trimSearchResponse,
} from "../shared/response-trimmer";
import type { ToolResponse } from "../shared/tool-entry";

export async function reverseGeocodeHandler(
  params: ReverseGeocodeSearchParams
): Promise<ToolResponse> {
  const { position, show_ui = true, response_detail = "compact", ...options } = params;
  logger.info({ lng: position[0], lat: position[1] }, "Reverse geocoding");
  try {
    const result = await reverseGeocode(position, options);
    return await buildToolResponse(
      result,
      (r) => trimSearchResponse(r, requestedSearchFields(params)),
      {
        showUI: show_ui,
        responseDetail: response_detail,
        dataset: { kind: "places", provenance: { tool: "tomtom-reverse-geocode", params } },
      }
    );
  } catch (error: unknown) {
    return buildErrorResponse(error, "Reverse geocoding");
  }
}

/**
 * POI categories is not a data tool: it returns a small static lookup table, so
 * there is nothing to store for an app and nothing to trim.
 */
export async function poiCategoriesHandler(params: PoiCategoriesParams): Promise<ToolResponse> {
  logger.info("POI categories lookup");
  try {
    const result = await fetchPOICategories(params.filters);
    return {
      content: [{ type: "text", text: JSON.stringify({ ...result, _meta: { show_ui: false } }) }],
    };
  } catch (error: unknown) {
    return buildErrorResponse(error, "POI categories lookup");
  }
}
