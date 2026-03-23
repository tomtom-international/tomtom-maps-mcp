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
 * Handler for Search Along Route tool.
 * Processes combined route + search results and trims for token efficiency.
 */

import { logger } from "../utils/logger";
import { searchAlongRoute } from "../services/search/searchAlongRouteSDKService";
import type { SearchAlongRouteResult } from "../services/search/searchAlongRouteSDKService";
import { buildCompressedResponse, trimGeoJSONFeatureProperties } from "./shared/responseTrimmer";

/**
 * Trim combined route + search response.
 * Keeps only route start/end coordinates, removes sections/progress,
 * and uses shared GeoJSON trimmer for POI features.
 */
function trimSearchAlongRouteResponse(response: SearchAlongRouteResult): SearchAlongRouteResult {
  const trimmed = structuredClone(response);

  // Trim route: keep only start/end coordinates, remove verbose sections
  if (trimmed.route?.features) {
    trimmed.route.features.forEach((feature) => {
      const geom = feature.geometry as { coordinates?: unknown[] } | undefined;
      if (geom?.coordinates) {
        const coords = geom.coordinates;
        if (Array.isArray(coords) && coords.length > 2) {
          geom.coordinates = [coords[0], coords[coords.length - 1]];
        }
      }

      const props = (feature.properties ?? {}) as Record<string, unknown>;
      delete props.sections;
      delete props.progress;
      delete props.guidance;
    });
  }

  // Trim POIs using shared GeoJSON feature trimmer
  if (trimmed.pois?.features) {
    trimmed.pois.features.forEach((feature) => {
      const props = (feature.properties ?? {}) as Record<string, unknown>;
      trimGeoJSONFeatureProperties(props);
    });
  }

  return trimmed;
}

/**
 * Create handler for Search Along Route tool.
 */
export function createSearchAlongRouteHandler() {
  return async (params: Record<string, unknown>) => {
    logger.info("Search along route");
    try {
      const { show_ui = true, response_detail = "compact", ...searchParams } = params;

      const result = await searchAlongRoute(
        searchParams as unknown as Parameters<typeof searchAlongRoute>[0]
      );

      logger.info(
        {
          poiCount: result?.pois?.features?.length || 0,
          corridorWidth: result?.summary?.corridorWidthMeters,
        },
        "Search along route completed"
      );

      // If full response requested, return without trimming
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
        };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimSearchAlongRouteResponse(result);
      return await buildCompressedResponse(trimmed, result, show_ui as boolean);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "Search along route failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}
