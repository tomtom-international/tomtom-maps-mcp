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
 * Search SDK Service
 * Uses TomTom Maps SDK search(), geocode(), and reverseGeocode() directly
 * instead of raw REST API calls.
 */

import {
  search,
  geocode,
  reverseGeocode as sdkReverseGeocode,
  getPOICategories,
  calculateRoute,
  getPlacesWithEVAvailability,
  type SearchResponse,
  type FuzzySearchParams,
  type GeocodingResponse,
  type ReverseGeocodingResponse,
  type POICategoriesResponse,
  type CalculateRouteParams,
  type RouteType,
} from "@tomtom-org/maps-sdk/services";
import { getEffectiveApiKey } from "../base/tomtomClient";
import { logger } from "../../utils/logger";
import buffer from "@turf/buffer";
import type { Polygon, Position } from "geojson";
import type { BBox, Language, Places, POICategory, Routes } from "@tomtom-org/maps-sdk/core";

// Options shared by multiple search functions
interface BaseSearchOptions {
  limit?: number;
  language?: string;
  countries?: string[];
  position?: Position;
  radius?: number;
  boundingBox?: BBox;
}

interface FuzzySearchOptions extends BaseSearchOptions {
  typeahead?: boolean;
  minFuzzyLevel?: number;
  maxFuzzyLevel?: number;
  poiCategories?: POICategory[];
}

interface NearbySearchOptions {
  radius?: number;
  limit?: number;
  language?: Language;
  countries?: string[];
  poiCategories?: POICategory[];
}

/**
 * Searches for places based on a free-text query
 */
export async function searchPlaces(query: string): Promise<SearchResponse> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error("API key not available");

  logger.debug({ query }, "Searching for places via SDK");
  return search({ apiKey, query, limit: 10 });
}

/**
 * Performs a fuzzy search for places, addresses, and POIs with advanced options
 */
export async function fuzzySearch(
  query: string,
  options?: FuzzySearchOptions
): Promise<SearchResponse> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error("API key not available");

  logger.debug({ query }, "Fuzzy searching via SDK");

  const params: Record<string, unknown> = {
    apiKey,
    query,
    limit: options?.limit ?? 10,
  };

  if (options?.position) params.position = options.position;
  if (options?.radius !== undefined) params.radiusMeters = options.radius;
  if (options?.language !== undefined) params.language = options.language;
  if (options?.typeahead !== undefined) params.typeahead = options.typeahead;
  if (options?.minFuzzyLevel !== undefined) params.minFuzzyLevel = options.minFuzzyLevel;
  if (options?.maxFuzzyLevel !== undefined) params.maxFuzzyLevel = options.maxFuzzyLevel;
  if (options?.countries?.length) params.countries = options.countries;
  if (options?.poiCategories?.length) params.poiCategories = options.poiCategories;
  if (options?.boundingBox) params.boundingBox = options.boundingBox;

  return search(params as Parameters<typeof search>[0]);
}

/**
 * Search specifically for Points of Interest (POIs)
 */
export async function poiSearch(
  query: string,
  options?: FuzzySearchOptions
): Promise<SearchResponse> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error("API key not available");

  logger.debug({ query }, "POI searching via SDK");

  const params: Record<string, unknown> = {
    apiKey,
    query,
    indexes: ["POI"],
    limit: options?.limit ?? 10,
  };

  if (options?.position) params.position = options.position;
  if (options?.radius !== undefined) params.radiusMeters = options.radius;
  if (options?.language !== undefined) params.language = options.language;
  if (options?.countries?.length) params.countries = options.countries;
  if (options?.poiCategories?.length) params.poiCategories = options.poiCategories;

  return search(params as Parameters<typeof search>[0]);
}

/**
 * Geocodes an address to coordinates
 */
export async function geocodeAddress(
  query: string,
  options?: BaseSearchOptions
): Promise<GeocodingResponse> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error("API key not available");

  logger.debug({ query }, "Geocoding via SDK");

  const params: Record<string, unknown> = {
    apiKey,
    query,
    limit: options?.limit ?? 10,
  };

  if (options?.language !== undefined) params.language = options.language;
  if (options?.countries?.length) params.countrySet = options.countries;
  if (options?.position) params.position = options.position;
  if (options?.boundingBox) params.boundingBox = options.boundingBox;

  return geocode(params as Parameters<typeof geocode>[0]);
}

/**
 * Reverse geocodes coordinates to an address.
 * @param position [longitude, latitude] (GeoJSON convention)
 */
export async function reverseGeocode(
  position: Position,
  options?: { language?: Language; radius?: number }
): Promise<ReverseGeocodingResponse> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error("API key not available");

  logger.debug({ lng: position[0], lat: position[1] }, "Reverse geocoding via SDK");

  const params: Record<string, unknown> = {
    apiKey,
    position,
  };

  if (options?.language !== undefined) params.language = options.language;
  if (options?.radius !== undefined) params.radius = options.radius;

  return sdkReverseGeocode(params as Parameters<typeof sdkReverseGeocode>[0]);
}

/**
 * Searches for points of interest (POIs) near a location.
 * @param position [longitude, latitude] (GeoJSON convention)
 */
export async function searchNearby(
  position: Position,
  options?: NearbySearchOptions
): Promise<SearchResponse> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error("API key not available");

  logger.debug(
    { lng: position[0], lat: position[1], radius: options?.radius ?? 1000 },
    "Nearby search via SDK"
  );

  const params: FuzzySearchParams = {
    apiKey,
    query: "*",
    position,
    radiusMeters: options?.radius ?? 1000,
    limit: options?.limit ?? 20,
  };

  if (options?.language) params.language = options.language;
  if (options?.countries?.length) params.countries = options.countries;
  if (options?.poiCategories?.length) params.poiCategories = options.poiCategories;

  return search(params);
}

/**
 * Retrieves POI categories, optionally filtered by keywords
 */
export async function fetchPOICategories(filters?: string[]): Promise<POICategoriesResponse> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error("API key not available");

  logger.debug({ filters }, "Fetching POI categories via SDK");

  const params: Record<string, unknown> = { apiKey };
  if (filters?.length) params.filters = filters;

  return getPOICategories(params as Parameters<typeof getPOICategories>[0]);
}

// ---------------------------------------------------------------------------
// Area / Geometry Search
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// EV Charging Station Search
// ---------------------------------------------------------------------------

export interface EVSearchParams {
  query?: string;
  /** Center position as [longitude, latitude] (GeoJSON convention) */
  position: Position;
  radius?: number;
  connectorTypes?: string[];
  minPowerKW?: number;
  limit?: number;
  includeAvailability?: boolean;
  language?: string;
  countries?: string[];
}

/**
 * Search for EV charging stations using TomTom Maps SDK.
 *
 * Uses SDK's search() with poiCategories filter for EV stations,
 * then enriches results with real-time availability via getPlacesWithEVAvailability().
 */
export async function searchEVStations(params: EVSearchParams): Promise<Places> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error("API key not available");

  logger.debug(
    { lng: params.position[0], lat: params.position[1], radius: params.radius },
    "Searching EV charging stations via SDK"
  );

  // Build SDK search params
  const searchParams: Record<string, unknown> = {
    apiKey,
    query: params.query || "EV charging station",
    poiCategories: ["ELECTRIC_VEHICLE_STATION"] as POICategory[],
    position: params.position,
    limit: params.limit || 10,
  };

  if (params.radius !== undefined) searchParams.radiusMeters = params.radius;
  if (params.connectorTypes) searchParams.connectors = params.connectorTypes;
  if (params.language) searchParams.language = params.language;
  if (params.countries && params.countries.length > 0) {
    searchParams.countries = params.countries;
  }

  // Call SDK search
  const searchResult = await search(searchParams as Parameters<typeof search>[0]);

  // Post-filter by minimum power if requested (SDK doesn't support this natively)
  let filteredResult = searchResult;
  if (params.minPowerKW && searchResult.features?.length) {
    const minPower = params.minPowerKW;
    filteredResult = {
      ...searchResult,
      features: searchResult.features.filter((feature) => {
        const chargingPark = (feature.properties as Record<string, unknown> | null)
          ?.chargingPark as { connectors?: Array<{ ratedPowerKW?: number }> } | undefined;
        if (!chargingPark?.connectors) return true;
        return chargingPark.connectors.some((c) => (c.ratedPowerKW ?? 0) >= minPower);
      }),
    };
  }

  // Enrich with real-time availability if requested
  if (params.includeAvailability !== false && filteredResult.features?.length > 0) {
    try {
      const enriched = await getPlacesWithEVAvailability(filteredResult);
      logger.debug(
        { stationCount: enriched.features?.length },
        "EV availability enrichment successful"
      );
      return enriched;
    } catch (e: unknown) {
      logger.warn(
        { error: e instanceof Error ? e.message : String(e) },
        "EV availability enrichment failed, returning basic search results"
      );
      return filteredResult;
    }
  }

  return filteredResult;
}

// ---------------------------------------------------------------------------
// Search Along Route
// ---------------------------------------------------------------------------

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
