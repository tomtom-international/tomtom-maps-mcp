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
  type SearchResponse,
  type FuzzySearchParams,
  type GeocodingResponse,
  type ReverseGeocodingResponse,
  type POICategoriesResponse,
} from "@tomtom-org/maps-sdk/services";
import { getEffectiveApiKey } from "../base/tomtomClient";
import { logger } from "../../utils/logger";
import type { Position } from "geojson";
import type { BBox, Language, POICategory } from "@tomtom-org/maps-sdk/core";

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
export async function fetchPOICategories(
  filters?: string[]
): Promise<POICategoriesResponse> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error("API key not available");

  logger.debug({ filters }, "Fetching POI categories via SDK");

  const params: Record<string, unknown> = { apiKey };
  if (filters?.length) params.filters = filters;

  return getPOICategories(params as Parameters<typeof getPOICategories>[0]);
}
