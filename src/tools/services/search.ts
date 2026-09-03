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

import type { Position } from "geojson";
import type {
  AreaSearchParams,
  EvSearchParams,
  FuzzySearchParams,
  GeocodeSearchParams,
  NearbySearchParams,
  PoiCategoriesParams,
  PoiSearchParams,
  ReverseGeocodeSearchParams,
  SearchAlongRouteParams,
} from "../../schemas/search/searchSchema";
import { generateCirclePoints } from "../../services/map/geometryUtils";
import type { AreaSearchOptions } from "../../services/search/searchService";
import {
  fetchPOICategories,
  fuzzySearch,
  geocodeAddress,
  poiSearch,
  reverseGeocode,
  searchAlongRoute,
  searchEVStations,
  searchInArea,
  searchNearby,
} from "../../services/search/searchService";
import { handleApiError } from "../../utils/apiErrorHandler";
import { logger } from "../../utils/logger";
import { defineDataTool } from "../shared/define-data-tool";
import {
  trimAreaSearchResponse,
  trimEVSearchResponse,
  trimSearchAlongRouteResponse,
  trimSearchResponse,
} from "../shared/response-trimmer";
import type { ToolResponse } from "../shared/tool-entry";

export const reverseGeocodeHandler = defineDataTool<ReverseGeocodeSearchParams, unknown>({
  verb: "Reverse geocoding",
  name: "tomtom-reverse-geocode",
  kind: "places",
  execute: ({ position, ...options }) =>
    reverseGeocode(
      position as Position,
      Object.keys(options).length > 0
        ? (options as Parameters<typeof reverseGeocode>[1])
        : undefined
    ),
  project: trimSearchResponse,
});

/**
 * POI categories is not a data tool: it returns a small static lookup table, so
 * there is nothing to cache for an app and nothing to trim. Hand-written to keep
 * that honest rather than bending `defineDataTool` around it.
 */
export async function poiCategoriesHandler(params: PoiCategoriesParams): Promise<ToolResponse> {
  logger.info("POI categories lookup");
  try {
    const result = await fetchPOICategories(params.filters);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ...result, _meta: { show_ui: false } }, null, 2),
        },
      ],
    };
  } catch (error: unknown) {
    const formattedError = handleApiError(error, "POI categories lookup");
    logger.error({ error: formattedError.message }, "POI categories lookup failed");
    return {
      content: [{ type: "text", text: JSON.stringify({ error: formattedError.message }) }],
      isError: true,
    };
  }
}
