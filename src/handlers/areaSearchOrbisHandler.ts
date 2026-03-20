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
 * Handler for Geometry/Area Search tool.
 * Processes SDK search response (GeoJSON) and trims for token efficiency.
 */

import { logger } from "../utils/logger";
import { searchInArea } from "../services/search/areaSearchSDKService";
import { buildCompressedResponse } from "./shared/responseTrimmer";
import { generateCirclePoints } from "../services/map/geometryUtils";

/**
 * Trim SDK GeoJSON search response for area search.
 * Removes verbose POI metadata, entry points, and redundant address fields.
 */
function trimAreaSearchResponse(response: any): any {
  if (!response?.features) return response;

  const trimmed = structuredClone(response);

  trimmed.features = trimmed.features.map((feature: any) => {
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

  return trimmed;
}

/**
 * Build a GeoJSON Feature representing the search boundary geometry.
 * Converts circle/polygon/boundingBox input params into a Polygon feature
 * so the MCP app can draw the boundary on the map.
 */
function buildSearchBoundaryFeature(searchParams: any): any | null {
  if (searchParams.polygon && searchParams.polygon.length >= 3) {
    const coordinates = searchParams.polygon.map((p: any) => [p.lon, p.lat]);
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      coordinates.push([...first]);
    }
    return {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [coordinates] },
      properties: { geometryType: "polygon" },
    };
  }

  if (searchParams.center && searchParams.radius) {
    const points = generateCirclePoints(
      searchParams.center.lat,
      searchParams.center.lon,
      searchParams.radius,
      64
    );
    const coordinates = points.map((p) => [p.lon, p.lat]);
    coordinates.push([...coordinates[0]]);
    return {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [coordinates] },
      properties: { geometryType: "circle" },
    };
  }

  if (searchParams.boundingBox) {
    const { topLeft, bottomRight } = searchParams.boundingBox;
    return {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [topLeft.lon, topLeft.lat],
            [bottomRight.lon, topLeft.lat],
            [bottomRight.lon, bottomRight.lat],
            [topLeft.lon, bottomRight.lat],
            [topLeft.lon, topLeft.lat],
          ],
        ],
      },
      properties: { geometryType: "boundingBox" },
    };
  }

  return null;
}

/**
 * Create handler for Geometry/Area Search tool.
 */
export function createAreaSearchHandler() {
  return async (params: any) => {
    logger.info("Area/geometry search");
    try {
      const { show_ui = true, response_detail = "compact", ...searchParams } = params;

      const result = await searchInArea(searchParams);

      logger.info({ resultCount: result?.features?.length || 0 }, "Area search completed");

      // Attach search boundary so the app can draw it on the map
      const boundary = buildSearchBoundaryFeature(searchParams);
      const resultWithBoundary = boundary ? { ...result, _searchBoundary: boundary } : result;

      // If full response requested, return without trimming
      if (response_detail === "full") {
        const response = { ...resultWithBoundary, _meta: { show_ui } };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
        };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimAreaSearchResponse(result);
      return await buildCompressedResponse(trimmed, resultWithBoundary, show_ui);
    } catch (error: any) {
      logger.error({ error: error.message }, "Area search failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}
