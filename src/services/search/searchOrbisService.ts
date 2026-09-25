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
  type GeometrySearchParams,
  type GeocodingParams,
  type GeocodingResponse,
  type ReverseGeocodingParams,
  type ReverseGeocodingResponse,
  type POICategoriesParams,
  type POICategoriesResponse,
  type CalculateRouteParams,
  type Circle,
  type SearchGeometryInput,
} from "@tomtom-org/maps-sdk/services";
import { getEffectiveApiKey } from "../base/tomtomClient";
import { logger } from "../../utils/logger";
import buffer from "@turf/buffer";
import type { Polygon, Position } from "geojson";
import type { Places, Routes } from "@tomtom-org/maps-sdk/core";
import type {
  AreaSearchOrbisParams,
  EvSearchOrbisParams,
  FuzzySearchOrbisParams,
  GeocodeSearchOrbisParams,
  NearbySearchOrbisParams,
  PoiSearchOrbisParams,
  ReverseGeocodeSearchOrbisParams,
  SearchAlongRouteOrbisParams,
} from "../../schemas/search/searchOrbisSchema";
import { toBBox, toConnectorTypes, toLanguage, toPOICategories } from "../shared/sdkInputs";

// The tool inputs each search function maps to SDK parameters
export type FuzzySearchOptions = Pick<
  FuzzySearchOrbisParams,
  | "limit"
  | "language"
  | "countries"
  | "position"
  | "radius"
  | "boundingBox"
  | "typeahead"
  | "minFuzzyLevel"
  | "maxFuzzyLevel"
  | "poiCategories"
>;
export type PoiSearchOptions = Pick<
  PoiSearchOrbisParams,
  "limit" | "language" | "countries" | "position" | "radius" | "poiCategories"
>;
export type GeocodeOptions = Pick<
  GeocodeSearchOrbisParams,
  "limit" | "language" | "countries" | "position" | "boundingBox"
>;
export type ReverseGeocodeOptions = Pick<ReverseGeocodeSearchOrbisParams, "language" | "radius">;
export type NearbySearchOptions = Pick<
  NearbySearchOrbisParams,
  "radius" | "limit" | "language" | "countries" | "poiCategories"
>;

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

  const params: FuzzySearchParams = {
    apiKey,
    query,
    limit: options?.limit ?? 10,
  };

  if (options?.position) params.position = options.position;
  if (options?.radius !== undefined) params.radiusMeters = options.radius;
  const language = toLanguage(options?.language);
  if (language !== undefined) params.language = language;
  if (options?.typeahead !== undefined) params.typeahead = options.typeahead;
  if (options?.minFuzzyLevel !== undefined) params.minFuzzyLevel = options.minFuzzyLevel;
  if (options?.maxFuzzyLevel !== undefined) params.maxFuzzyLevel = options.maxFuzzyLevel;
  if (options?.countries?.length) params.countries = options.countries;
  const poiCategories = toPOICategories(options?.poiCategories);
  if (poiCategories) params.poiCategories = poiCategories;
  const boundingBox = toBBox(options?.boundingBox);
  if (boundingBox) params.boundingBox = boundingBox;

  return search(params);
}

/**
 * Search specifically for Points of Interest (POIs)
 */
export async function poiSearch(
  query: string,
  options?: PoiSearchOptions
): Promise<SearchResponse> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error("API key not available");

  logger.debug({ query }, "POI searching via SDK");

  const params: FuzzySearchParams = {
    apiKey,
    query,
    indexes: ["POI"],
    limit: options?.limit ?? 10,
  };

  if (options?.position) params.position = options.position;
  if (options?.radius !== undefined) params.radiusMeters = options.radius;
  const language = toLanguage(options?.language);
  if (language !== undefined) params.language = language;
  if (options?.countries?.length) params.countries = options.countries;
  const poiCategories = toPOICategories(options?.poiCategories);
  if (poiCategories) params.poiCategories = poiCategories;

  return search(params);
}

/**
 * Geocodes an address to coordinates
 */
export async function geocodeAddress(
  query: string,
  options?: GeocodeOptions
): Promise<GeocodingResponse> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error("API key not available");

  logger.debug({ query }, "Geocoding via SDK");

  const params: GeocodingParams = {
    apiKey,
    query,
    limit: options?.limit ?? 10,
  };

  const language = toLanguage(options?.language);
  if (language !== undefined) params.language = language;
  if (options?.countries?.length) params.countries = options.countries;
  if (options?.position) params.position = options.position;
  const boundingBox = toBBox(options?.boundingBox);
  if (boundingBox) params.boundingBox = boundingBox;

  return geocode(params);
}

/**
 * Reverse geocodes coordinates to an address.
 * @param position [longitude, latitude] (GeoJSON convention)
 */
export async function reverseGeocode(
  position: Position,
  options?: ReverseGeocodeOptions
): Promise<ReverseGeocodingResponse> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error("API key not available");

  logger.debug({ lng: position[0], lat: position[1] }, "Reverse geocoding via SDK");

  const params: ReverseGeocodingParams = {
    apiKey,
    position,
  };

  const language = toLanguage(options?.language);
  if (language !== undefined) params.language = language;
  if (options?.radius !== undefined) params.radiusMeters = options.radius;

  return sdkReverseGeocode(params);
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

  const language = toLanguage(options?.language);
  if (language) params.language = language;
  if (options?.countries?.length) params.countries = options.countries;
  const poiCategories = toPOICategories(options?.poiCategories);
  if (poiCategories) params.poiCategories = poiCategories;

  return search(params);
}

/**
 * Retrieves POI categories, optionally filtered by keywords
 */
export async function fetchPOICategories(filters?: string[]): Promise<POICategoriesResponse> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error("API key not available");

  logger.debug({ filters }, "Fetching POI categories via SDK");

  const params: POICategoriesParams = { apiKey };
  if (filters?.length) params.filters = filters;

  return getPOICategories(params);
}

// ---------------------------------------------------------------------------
// Area / Geometry Search
// ---------------------------------------------------------------------------

export type AreaSearchParams = Pick<
  AreaSearchOrbisParams,
  "query" | "center" | "radius" | "polygon" | "boundingBox" | "limit" | "poiCategories" | "language"
>;

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

  let geometry: SearchGeometryInput;
  if (params.center && params.radius) {
    // Circle geometry — center is [lng, lat]
    const circle: Circle = { type: "Circle", coordinates: params.center, radius: params.radius };
    geometry = circle;
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
    const polygon: Polygon = { type: "Polygon", coordinates: [coordinates] };
    geometry = polygon;
    logger.debug(
      { vertexCount: params.polygon.length },
      "Area search with polygon geometry via SDK"
    );
  } else if (params.boundingBox) {
    // Convert bounding box [[topLeftLon, topLeftLat], [bottomRightLon, bottomRightLat]] to polygon
    const [[tlLon, tlLat], [brLon, brLat]] = params.boundingBox;
    const polygon: Polygon = {
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
    };
    geometry = polygon;
    logger.debug(
      { boundingBox: params.boundingBox },
      "Area search with bounding box geometry via SDK"
    );
  } else {
    throw new Error(
      "At least one geometry must be provided: center+radius (circle), polygon, or boundingBox"
    );
  }

  const searchParams: GeometrySearchParams = {
    apiKey,
    query: params.query,
    geometries: [geometry],
    limit: params.limit || 10,
  };

  const language = toLanguage(params.language);
  if (language) searchParams.language = language;
  const poiCategories = toPOICategories(params.poiCategories);
  if (poiCategories) searchParams.poiCategories = poiCategories;

  const result = await search(searchParams);

  logger.debug({ resultCount: result.features?.length }, "Area search completed");

  return result;
}

// ---------------------------------------------------------------------------
// EV Charging Station Search
// ---------------------------------------------------------------------------

export type EVSearchParams = Pick<
  EvSearchOrbisParams,
  | "query"
  | "position"
  | "radius"
  | "connectorTypes"
  | "minPowerKW"
  | "limit"
  | "includeAvailability"
  | "language"
  | "countries"
>;

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

  const searchParams: FuzzySearchParams = {
    apiKey,
    query: params.query || "EV charging station",
    poiCategories: ["ELECTRIC_VEHICLE_STATION"],
    position: params.position,
    limit: params.limit || 10,
  };

  if (params.radius !== undefined) searchParams.radiusMeters = params.radius;
  const connectors = toConnectorTypes(params.connectorTypes);
  if (connectors) searchParams.connectors = connectors;
  const language = toLanguage(params.language);
  if (language) searchParams.language = language;
  if (params.countries && params.countries.length > 0) {
    searchParams.countries = params.countries;
  }

  const searchResult = await search(searchParams);

  // Post-filter by minimum power if requested (SDK doesn't support this natively)
  let filteredResult = searchResult;
  if (params.minPowerKW && searchResult.features?.length) {
    const minPower = params.minPowerKW;
    const features = searchResult.features.filter((feature) => {
      // The SDK groups connectors as { connector, count }, so the power is on
      // connector, not on the entry itself (#284).
      const connectors = feature.properties?.chargingPark?.connectors;
      if (!connectors) return true;
      return connectors.some((c) => (c.connector?.ratedPowerKW ?? 0) >= minPower);
    });

    // The API's numResults/totalResults describe the unfiltered response;
    // after client-side filtering the true total is unknowable, so recompute
    // both from the surviving features to keep metadata consistent.
    filteredResult = {
      ...searchResult,
      features,
      ...(searchResult.properties && {
        properties: {
          ...searchResult.properties,
          numResults: features.length,
          totalResults: features.length,
        },
      }),
    };
  }

  // Enrich with real-time availability if requested
  if (params.includeAvailability !== false && filteredResult.features?.length > 0) {
    try {
      // Forward the API key to the per-station availability requests. Since SDK
      // 0.49.0 (maps-sdk-js#1888) this helper accepts common service params;
      // otherwise it reads the key from global config, which we never set.
      const enriched = await getPlacesWithEVAvailability(filteredResult, { apiKey });
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

export type SearchAlongRouteParams = Pick<
  SearchAlongRouteOrbisParams,
  | "origin"
  | "destination"
  | "query"
  | "corridorWidth"
  | "limit"
  | "poiCategories"
  | "language"
  | "routeType"
>;

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
  const routeParams: CalculateRouteParams = {
    apiKey,
    locations: [params.origin, params.destination],
    costModel: { routeType: params.routeType ?? "fast" },
  };
  const routeResult = await calculateRoute(routeParams);

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

  const searchParams: GeometrySearchParams = {
    apiKey,
    query: params.query,
    geometries: [buffered.geometry],
    limit: params.limit || 10,
  };

  const language = toLanguage(params.language);
  if (language) searchParams.language = language;
  const poiCategories = toPOICategories(params.poiCategories);
  if (poiCategories) searchParams.poiCategories = poiCategories;

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
