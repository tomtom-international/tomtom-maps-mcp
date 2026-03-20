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
 * Search Along Route SDK Service
 * Uses TomTom Maps SDK:
 * 1. calculateRoute() to get the route geometry
 * 2. geometrySearch() with route corridor to find POIs along the route
 */

import { calculateRoute, search } from "@tomtom-org/maps-sdk/services";
import buffer from "@turf/buffer";
import type { Polygon } from "geojson";
import { getEffectiveApiKey } from "../base/tomtomClient";
import { logger } from "../../utils/logger";

export interface SearchAlongRouteParams {
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number };
  query: string;
  corridorWidth?: number;
  limit?: number;
  categorySet?: string;
  language?: string;
  routeType?: "fast" | "short" | "efficient";
}

/**
 * Search for POIs along a route corridor.
 *
 * Two-step process using SDK:
 * 1. calculateRoute() to get the route LineString geometry
 * 2. geometrySearch() with the route geometry as a search corridor
 *
 * @param params Search along route parameters
 * @returns Object with both route and search results (both GeoJSON)
 */
export async function searchAlongRoute(params: SearchAlongRouteParams): Promise<any> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error("API key not available");

  logger.debug(
    { origin: params.origin, destination: params.destination, query: params.query },
    "Searching along route via SDK"
  );

  // Step 1: Calculate route to get geometry
  const routeResult = await calculateRoute({
    apiKey,
    locations: [
      [params.origin.lon, params.origin.lat] as [number, number],
      [params.destination.lon, params.destination.lat] as [number, number],
    ],
    routeType: params.routeType || "fast",
  } as any);

  if (!routeResult.features?.length) {
    throw new Error("Could not calculate route between origin and destination");
  }

  // Extract route feature
  const routeFeature = routeResult.features[0];

  // Step 2: Buffer the route LineString into a Polygon corridor
  // SDK geometries only support Polygon/Circle, not LineString.
  // Use @turf/buffer to create a polygon corridor around the route.
  const corridorWidth = params.corridorWidth || 5000; // 5km default
  const corridorKm = corridorWidth / 1000;
  const buffered = buffer(routeFeature, corridorKm, { units: "kilometers" });
  if (!buffered) {
    throw new Error("Could not create search corridor from route geometry");
  }

  // Build SDK search params with buffered polygon
  const searchParams: any = {
    apiKey,
    query: params.query,
    geometries: [buffered.geometry as Polygon],
    limit: params.limit || 10,
  };

  if (params.language) searchParams.language = params.language;
  if (params.categorySet) {
    searchParams.poiCategories = params.categorySet.split(",").map((c: string) => {
      const num = parseInt(c.trim(), 10);
      return isNaN(num) ? c.trim() : num;
    });
  }

  const searchResult = await search(searchParams);

  logger.debug({ poiCount: searchResult.features?.length }, "Search along route completed");

  // Return combined result with route and POIs
  return {
    route: routeResult,
    pois: searchResult,
    summary: {
      routeLengthMeters: routeFeature.properties?.summary?.lengthInMeters,
      routeTravelTimeSeconds: routeFeature.properties?.summary?.travelTimeInSeconds,
      poiCount: searchResult.features?.length || 0,
      corridorWidthMeters: corridorWidth,
    },
  };
}
