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
 * Geometry/Area Search SDK Service
 * Uses TomTom Maps SDK search() to find POIs within
 * geometric areas (circles, polygons, bounding boxes).
 */

import { search } from "@tomtom-org/maps-sdk/services";
import type { SearchResponse } from "@tomtom-org/maps-sdk/services";
import type { POICategory } from "@tomtom-org/maps-sdk/core";
import { getEffectiveApiKey } from "../base/tomtomClient";
import { logger } from "../../utils/logger";
import type { Position } from "geojson";

export interface AreaSearchParams {
  query: string;
  /** Circle center as [longitude, latitude] (GeoJSON convention) */
  center?: Position;
  radius?: number;
  /** Polygon vertices as [longitude, latitude] positions */
  polygon?: Position[];
  /** Bounding box as [[topLeftLon, topLeftLat], [bottomRightLon, bottomRightLat]] */
  boundingBox?: [Position, Position];
  limit?: number;
  poiCategories?: POICategory[];
  language?: string;
  countries?: string[];
}

/**
 * Search for POIs within a geometric area.
 *
 * Supports three geometry types:
 * 1. Circle (center + radius) — most common
 * 2. Polygon (array of vertices) — custom areas
 * 3. Bounding box ([[topLeftLon, topLeftLat], [bottomRightLon, bottomRightLat]]) — rectangular areas
 *
 * Uses SDK's search() with the specified geometry.
 *
 * @param params Area search parameters
 * @returns SDK SearchResponse (GeoJSON FeatureCollection)
 */
export async function searchInArea(params: AreaSearchParams): Promise<SearchResponse> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error("API key not available");

  // Build geometry based on provided parameters
  const geometries: Array<{
    type: string;
    coordinates: Position | Position[] | Position[][];
    radius?: number;
  }> = [];

  if (params.center && params.radius) {
    // Circle geometry — center is [lng, lat]
    geometries.push({
      type: "Circle" as const,
      coordinates: params.center,
      radius: params.radius,
    });
    logger.debug(
      { centerLng: params.center[0], centerLat: params.center[1], radius: params.radius },
      "Area search with circle geometry via SDK"
    );
  } else if (params.polygon && params.polygon.length >= 3) {
    // Polygon geometry — each vertex is [lng, lat]
    const coordinates = params.polygon.map((p) => [p[0], p[1]]);
    // Close the polygon if not already closed
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      coordinates.push([...first]);
    }
    geometries.push({
      type: "Polygon" as const,
      coordinates: [coordinates],
    });
    logger.debug(
      { vertexCount: params.polygon.length },
      "Area search with polygon geometry via SDK"
    );
  } else if (params.boundingBox) {
    // Convert bounding box [[topLeftLon, topLeftLat], [bottomRightLon, bottomRightLat]] to polygon
    const [[tlLon, tlLat], [brLon, brLat]] = params.boundingBox;
    geometries.push({
      type: "Polygon" as const,
      coordinates: [
        [
          [tlLon, tlLat],
          [brLon, tlLat],
          [brLon, brLat],
          [tlLon, brLat],
          [tlLon, tlLat],
        ],
      ],
    });
    logger.debug(
      { boundingBox: params.boundingBox },
      "Area search with bounding box geometry via SDK"
    );
  } else {
    throw new Error(
      "At least one geometry must be provided: center+radius (circle), polygon, or boundingBox"
    );
  }

  // Build SDK search params
  const searchParams: Record<string, unknown> = {
    apiKey,
    query: params.query,
    geometries,
    limit: params.limit || 10,
  };

  if (params.language) searchParams.language = params.language;
  if (params.countries && params.countries.length > 0) {
    searchParams.countries = params.countries;
  }
  if (params.poiCategories?.length) {
    searchParams.poiCategories = params.poiCategories;
  }

  const result = await search(searchParams as Parameters<typeof search>[0]);

  logger.debug({ resultCount: result.features?.length }, "Area search completed");

  return result;
}
