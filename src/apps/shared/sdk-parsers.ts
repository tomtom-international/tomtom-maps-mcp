/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 *
 * SDK Response Parsers - Uses TomTom SDK's built-in customizeService utilities
 * to parse API responses into the exact format the SDK expects for visualization.
 */

import { customizeService } from "@tomtom-org/maps-sdk/services";
import type { Routes, CalculateRouteParams } from "@tomtom-org/maps-sdk/services";
import type {
  GeocodingResponse,
  ReverseGeocodingResponse,
  ReverseGeocodingParams,
} from "@tomtom-org/maps-sdk/services";

/**
 * Default params for route parsing.
 * - language: Used for guidance text
 * - units: Important for distance display (metric vs imperial)
 */
const DEFAULT_ROUTE_PARAMS: Partial<CalculateRouteParams> = {
  language: "en-GB",
  units: "metric",
};

/**
 * Parse raw routing API response using SDK's built-in parser.
 * This ensures the data is in the exact format expected by RoutingModule.showRoutes()
 */
export function parseRoutingResponse(
  apiResponse: any,
  params?: Partial<CalculateRouteParams>
): Routes {
  const mergedParams = { ...DEFAULT_ROUTE_PARAMS, ...params } as CalculateRouteParams;
  return customizeService.calculateRoute.parseCalculateRouteResponse(apiResponse, mergedParams);
}

/**
 * Parse raw geocoding API response using SDK's built-in parser.
 * Returns properly formatted places for PlacesModule.show()
 */
export function parseGeocodingResponse(apiResponse: any): GeocodingResponse {
  return customizeService.geocode.parseGeocodingResponse(apiResponse);
}

/**
 * Parse raw reverse geocoding API response using SDK's built-in parser.
 */
export function parseReverseGeocodingResponse(
  apiResponse: any,
  params?: Partial<ReverseGeocodingParams>
): ReverseGeocodingResponse {
  const mergedParams = { language: "en-GB", ...params } as ReverseGeocodingParams;
  return customizeService.reverseGeocode.parseRevGeoResponse(apiResponse, mergedParams);
}

/**
 * Parse raw search API response using SDK's built-in parser.
 * Works for fuzzy search, POI search, and nearby search.
 */
export function parseSearchResponse(apiResponse: any): GeocodingResponse {
  // Search responses use the same format as geocoding
  return customizeService.geometrySearch.parseGeometrySearchResponse(apiResponse);
}

/**
 * Parse raw reachable range API response using SDK's built-in parser.
 */
export function parseReachableRangeResponse(apiResponse: any, params?: any) {
  const mergedParams = { language: "en-GB", units: "metric", ...params };
  return customizeService.reachableRange.parseReachableRangeResponse(apiResponse, mergedParams);
}

/**
 * Extract waypoints from parsed Routes as a Waypoints FeatureCollection.
 * The waypoints are formatted with proper properties for RoutingModule.showWaypoints()
 * including indexType for correct icon display (start, middle, finish).
 */
export function extractWaypointsFromRoutes(routes: Routes) {
  if (!routes.features?.length) {
    return { type: "FeatureCollection" as const, features: [] };
  }

  const route = routes.features[0];
  const coordinates = route.geometry.coordinates as [number, number][];
  const legs = route.properties.sections?.leg || [];

  const features: any[] = [];

  if (coordinates.length >= 2) {
    // Start waypoint (first coordinate)
    features.push({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: coordinates[0] },
      properties: {
        type: "Geography",
        address: { freeformAddress: "Start" },
        index: 0,
        indexType: "start",
      },
    });

    // Intermediate waypoints from leg end points
    for (let i = 0; i < legs.length - 1; i++) {
      const endIdx = legs[i].endPointIndex;
      if (endIdx !== undefined && coordinates[endIdx]) {
        features.push({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: coordinates[endIdx] },
          properties: {
            type: "Geography",
            address: { freeformAddress: `Stop ${i + 1}` },
            index: i + 1,
            indexType: "middle",
            stopDisplayIndex: i + 1,
          },
        });
      }
    }

    // End waypoint (last coordinate)
    features.push({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: coordinates[coordinates.length - 1] },
      properties: {
        type: "Geography",
        address: { freeformAddress: "End" },
        index: features.length,
        indexType: "finish",
      },
    });
  }

  return { type: "FeatureCollection" as const, features };
}
