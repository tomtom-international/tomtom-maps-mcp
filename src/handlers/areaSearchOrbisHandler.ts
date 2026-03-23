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
import type { AreaSearchParams } from "../services/search/areaSearchSDKService";
import { buildCompressedResponse, trimGeoJSONFeatureProperties } from "./shared/responseTrimmer";
import { generateCirclePoints } from "../services/map/geometryUtils";
import type { SearchResponse } from "@tomtom-org/maps-sdk/services";
import type { Feature, Polygon, Position } from "geojson";

/**
 * Trim SDK GeoJSON search response for area search.
 * Uses shared GeoJSON feature trimmer for consistent behavior.
 */
function trimAreaSearchResponse(response: SearchResponse): SearchResponse {
  if (!response?.features) return response;

  const trimmed = structuredClone(response);

  trimmed.features.forEach((feature) => {
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    trimGeoJSONFeatureProperties(props);
  });

  return trimmed;
}

/**
 * Build a GeoJSON Feature representing the search boundary geometry.
 * Converts circle/polygon/boundingBox input params into a Polygon feature
 * so the MCP app can draw the boundary on the map.
 */
function buildSearchBoundaryFeature(searchParams: AreaSearchParams): Feature<Polygon> | null {
  if (searchParams.polygon && searchParams.polygon.length >= 3) {
    // polygon is Position[] = [lng, lat][]
    const coordinates = searchParams.polygon.map((p: Position) => [p[0], p[1]]);
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
    // center is Position = [lng, lat]
    const [centerLon, centerLat] = searchParams.center;
    const points = generateCirclePoints(centerLat, centerLon, searchParams.radius, 64);
    const coordinates = points.map((p) => [p.lon, p.lat]);
    coordinates.push([...coordinates[0]]);
    return {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [coordinates] },
      properties: { geometryType: "circle" },
    };
  }

  if (searchParams.boundingBox) {
    // boundingBox is [[topLeftLon, topLeftLat], [bottomRightLon, bottomRightLat]]
    const [[tlLon, tlLat], [brLon, brLat]] = searchParams.boundingBox;
    return {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [tlLon, tlLat],
            [brLon, tlLat],
            [brLon, brLat],
            [tlLon, brLat],
            [tlLon, tlLat],
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
  return async (params: Record<string, unknown>) => {
    logger.info("Area/geometry search");
    try {
      const { show_ui = true, response_detail = "compact", ...searchParams } = params;

      const result = await searchInArea(searchParams as unknown as AreaSearchParams);

      logger.info({ resultCount: result?.features?.length || 0 }, "Area search completed");

      // Attach search boundary so the app can draw it on the map
      const boundary = buildSearchBoundaryFeature(searchParams as unknown as AreaSearchParams);
      const resultWithBoundary: SearchResponse & { _searchBoundary?: Feature<Polygon> } = boundary
        ? { ...result, _searchBoundary: boundary }
        : result;

      // If full response requested, return without trimming
      if (response_detail === "full") {
        const response = { ...resultWithBoundary, _meta: { show_ui } };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
        };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimAreaSearchResponse(result);
      return await buildCompressedResponse(trimmed, resultWithBoundary, show_ui as boolean);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "Area search failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}
