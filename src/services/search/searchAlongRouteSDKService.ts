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
 * 2. search() with route corridor to find POIs along the route
 */

import { calculateRoute, search } from "@tomtom-org/maps-sdk/services";
import type {
  CalculateRouteParams,
  RouteType,
  SearchResponse,
} from "@tomtom-org/maps-sdk/services";
import type { Routes, POICategory } from "@tomtom-org/maps-sdk/core";
import buffer from "@turf/buffer";
import type { Polygon, Position } from "geojson";
import { getEffectiveApiKey } from "../base/tomtomClient";
import { logger } from "../../utils/logger";

export interface SearchAlongRouteResult {
  route: Routes;
  pois: SearchResponse;
  summary: {
    routeLengthMeters: number | undefined;
    routeTravelTimeSeconds: number | undefined;
    poiCount: number;
    corridorWidthMeters: number;
  };
}

export interface SearchAlongRouteParams {
  /** Route origin as [longitude, latitude] (GeoJSON convention) */
  origin: Position;
  /** Route destination as [longitude, latitude] (GeoJSON convention) */
  destination: Position;
  query: string;
  corridorWidth?: number;
  limit?: number;
  poiCategories?: POICategory[];
  language?: string;
  routeType?: RouteType;
}

/**
 * Search for POIs along a route corridor.
 *
 * Two-step process using SDK:
 * 1. calculateRoute() to get the route LineString geometry
 * 2. search() with the route geometry as a search corridor
 *
 * @param params Search along route parameters
 * @returns Object with both route and search results (both GeoJSON)
 */
export async function searchAlongRoute(
  params: SearchAlongRouteParams
): Promise<SearchAlongRouteResult> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error("API key not available");

  logger.debug(
    {
      origin: { lng: params.origin[0], lat: params.origin[1] },
      destination: { lng: params.destination[0], lat: params.destination[1] },
      query: params.query,
    },
    "Searching along route via SDK"
  );

  // Step 1: Calculate route to get geometry
  // origin and destination are already [lng, lat] Position tuples
  const routeResult = await calculateRoute({
    apiKey,
    locations: [params.origin, params.destination],
    routeType: params.routeType ?? "fast",
  } as CalculateRouteParams);

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
  const searchParams: Record<string, unknown> = {
    apiKey,
    query: params.query,
    geometries: [buffered.geometry as Polygon],
    limit: params.limit || 10,
  };

  if (params.language) searchParams.language = params.language;
  if (params.poiCategories?.length) {
    searchParams.poiCategories = params.poiCategories;
  }

  const searchResult = await search(searchParams as Parameters<typeof search>[0]);

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
