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
 * Uses TomTom Maps SDK geometrySearch() to find POIs within
 * geometric areas (circles, polygons, bounding boxes).
 */

import { search } from "@tomtom-org/maps-sdk/services";
import { getEffectiveApiKey } from "../base/tomtomClient";
import { logger } from "../../utils/logger";

export interface AreaSearchParams {
  query: string;
  center?: { lat: number; lon: number };
  radius?: number;
  polygon?: Array<{ lat: number; lon: number }>;
  boundingBox?: {
    topLeft: { lat: number; lon: number };
    bottomRight: { lat: number; lon: number };
  };
  limit?: number;
  categorySet?: string;
  language?: string;
  countrySet?: string;
}

/**
 * Search for POIs within a geometric area.
 *
 * Supports three geometry types:
 * 1. Circle (center + radius) — most common
 * 2. Polygon (array of vertices) — custom areas
 * 3. Bounding box (topLeft + bottomRight) — rectangular areas
 *
 * Uses SDK's geometrySearch() with the specified geometry.
 *
 * @param params Area search parameters
 * @returns SDK SearchResponse (GeoJSON FeatureCollection)
 */
export async function searchInArea(params: AreaSearchParams): Promise<any> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error("API key not available");

  // Build geometry based on provided parameters
  const geometries: any[] = [];

  if (params.center && params.radius) {
    // Circle geometry
    geometries.push({
      type: "Circle" as const,
      coordinates: [params.center.lon, params.center.lat],
      radius: params.radius,
    });
    logger.debug(
      { center: params.center, radius: params.radius },
      "Area search with circle geometry via SDK"
    );
  } else if (params.polygon && params.polygon.length >= 3) {
    // Polygon geometry
    const coordinates = params.polygon.map((p) => [p.lon, p.lat]);
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
    // Convert bounding box to polygon
    const { topLeft, bottomRight } = params.boundingBox;
    geometries.push({
      type: "Polygon" as const,
      coordinates: [
        [
          [topLeft.lon, topLeft.lat],
          [bottomRight.lon, topLeft.lat],
          [bottomRight.lon, bottomRight.lat],
          [topLeft.lon, bottomRight.lat],
          [topLeft.lon, topLeft.lat],
        ],
      ],
    });
    logger.debug({ topLeft, bottomRight }, "Area search with bounding box geometry via SDK");
  } else {
    throw new Error(
      "At least one geometry must be provided: center+radius (circle), polygon, or boundingBox"
    );
  }

  // Build SDK geometrySearch params
  const searchParams: any = {
    apiKey,
    query: params.query,
    geometries,
    limit: params.limit || 10,
  };

  if (params.language) searchParams.language = params.language;
  if (params.countrySet) {
    searchParams.countries = params.countrySet.split(",").map((c: string) => c.trim());
  }
  if (params.categorySet) {
    searchParams.poiCategories = params.categorySet.split(",").map((c: string) => {
      const num = parseInt(c.trim(), 10);
      return isNaN(num) ? c.trim() : num;
    });
  }

  const result = await search(searchParams);

  logger.debug({ resultCount: result.features?.length }, "Area search completed");

  return result;
}
