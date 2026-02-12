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
import { buildCompressedResponse } from "./shared/responseTrimmer";

/**
 * Trim combined route + search response.
 * Removes heavy route coordinates, speedLimit/guidance sections,
 * and verbose POI metadata.
 */
function trimSearchAlongRouteResponse(response: any): any {
  const trimmed = structuredClone(response);

  // Trim route: remove heavy coordinate arrays and verbose sections
  if (trimmed.route?.features) {
    trimmed.route.features = trimmed.route.features.map((feature: any) => {
      if (feature.geometry?.coordinates) {
        const coords = feature.geometry.coordinates;
        if (Array.isArray(coords) && coords.length > 2) {
          feature.geometry = {
            ...feature.geometry,
            coordinates: [coords[0], coords[coords.length - 1]],
            _trimmed: true,
            _originalPointCount: coords.length,
          };
        }
      }

      const props = feature.properties || {};

      // Remove all sections — agent only needs route summary + POIs
      delete props.sections;

      // Remove point-by-point progress
      delete props.progress;

      return feature;
    });
  }

  // Trim POIs: remove verbose metadata
  if (trimmed.pois?.features) {
    trimmed.pois.features = trimmed.pois.features.map((feature: any) => {
      const props = feature.properties || {};

      if (props.poi) {
        delete props.poi.classifications;
        delete props.poi.categorySet;
        delete props.poi.timeZone;
        delete props.poi.features;
        delete props.poi.brands;
        delete props.poi.openingHours;
      }

      delete props.dataSources;
      delete props.matchConfidence;
      delete props.info;
      delete props.score;
      delete props.viewport;
      delete props.boundingBox;
      delete props.entryPoints;

      if (props.poi) {
        delete props.poi.categoryIds;
      }

      if (props.address) {
        delete props.address.countryCodeISO3;
        delete props.address.countrySubdivisionCode;
        delete props.address.countrySubdivisionName;
        delete props.address.localName;
        delete props.address.extendedPostalCode;
      }

      return feature;
    });
  }

  return trimmed;
}

/**
 * Create handler for Search Along Route tool.
 */
export function createSearchAlongRouteHandler() {
  return async (params: any) => {
    logger.info("Search along route");
    try {
      const { show_ui = true, response_detail = "compact", ...searchParams } = params;

      const result = await searchAlongRoute(searchParams);

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
      return await buildCompressedResponse(trimmed, result, show_ui);
    } catch (error: any) {
      logger.error({ error: error.message }, "Search along route failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}
