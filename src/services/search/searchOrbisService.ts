/*
 * Copyright (C) 2025 TomTom NV
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
 */

import { tomtomClient, validateApiKey, ORBIS_API_VERSION } from "../base/tomtomClient";
import { handleApiError } from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
import {
  SearchResult,
  ExtendedSearchOptions,
  ReverseGeocodeOptions,
  ReverseGeocodingResult,
  BaseSearchOptions,
} from "./types";

/**
 * Utility function to build API parameters from options
 */
function buildSearchParams(
  options: Partial<ExtendedSearchOptions> = {},
  defaults: Partial<ExtendedSearchOptions> = {}
): Record<string, any> {
  const mergedOptions = { ...defaults, ...options };
  const params: Record<string, any> = {};

  // Basic parameters
  if (mergedOptions.limit !== undefined) params.limit = mergedOptions.limit;
  if (mergedOptions.typeahead !== undefined) params.typeahead = mergedOptions.typeahead;
  if (mergedOptions.language !== undefined) params.language = mergedOptions.language;

  // Location parameters
  if (mergedOptions.lat !== undefined && mergedOptions.lon !== undefined) {
    params.lat = mergedOptions.lat;
    params.lon = mergedOptions.lon;
    if (mergedOptions.radius !== undefined) params.radius = mergedOptions.radius;
  }

  // Geographic filters
  if (mergedOptions.countrySet !== undefined) params.countrySet = mergedOptions.countrySet;
  if (mergedOptions.topLeft !== undefined && mergedOptions.btmRight !== undefined) {
    params.topLeft = mergedOptions.topLeft;
    params.btmRight = mergedOptions.btmRight;
  }

  // Category and brand filters
  if (mergedOptions.categorySet !== undefined) params.categorySet = mergedOptions.categorySet;
  if (mergedOptions.brandSet !== undefined) params.brandSet = mergedOptions.brandSet;

  // EV and fuel parameters
  if (mergedOptions.connectorSet !== undefined) params.connectorSet = mergedOptions.connectorSet;
  if (mergedOptions.fuelSet !== undefined) params.fuelSet = mergedOptions.fuelSet;
  if (mergedOptions.minPowerKW !== undefined) params.minPowerKW = mergedOptions.minPowerKW;
  if (mergedOptions.maxPowerKW !== undefined) params.maxPowerKW = mergedOptions.maxPowerKW;

  // Opening hours - handle string or boolean
  if (mergedOptions.openingHours !== undefined) {
    params.openingHours = "nextSevenDays";
  }

  // Availability flags
  if (mergedOptions.chargingAvailability !== undefined)
    params.chargingAvailability = mergedOptions.chargingAvailability;
  if (mergedOptions.parkingAvailability !== undefined)
    params.parkingAvailability = mergedOptions.parkingAvailability;
  if (mergedOptions.fuelAvailability !== undefined)
    params.fuelAvailability = mergedOptions.fuelAvailability;

  // Fuzzy level controls
  if (mergedOptions.minFuzzyLevel !== undefined) params.minFuzzyLevel = mergedOptions.minFuzzyLevel;
  if (mergedOptions.maxFuzzyLevel !== undefined) params.maxFuzzyLevel = mergedOptions.maxFuzzyLevel;

  // Additional API parameters
  const additionalParams = [
    "ofs",
    "mapcodes",
    "timeZone",
    "view",
    "relatedPois",
    "geometries",
    "sort",
    "extendedPostalCodesFor",
    "entityTypeSet",
    "roadUse",
    "addressRanges",
    "ext",
  ];

  additionalParams.forEach((param) => {
    if (mergedOptions[param as keyof ExtendedSearchOptions] !== undefined) {
      params[param] = mergedOptions[param as keyof ExtendedSearchOptions];
    }
  });

  return params;
}

/**
 * Utility function to build reverse geocoding parameters
 */
function buildReverseGeocodeParams(
  options: Partial<ReverseGeocodeOptions> = {},
  defaults: Partial<ReverseGeocodeOptions> = {}
): Record<string, any> {
  const mergedOptions = { ...defaults, ...options };

  // Extract roadUse separately since it has a different type
  const { roadUse, ...restOptions } = mergedOptions;

  // Build base params without roadUse
  const params = buildSearchParams(restOptions, {});

  // Ensure apiVersion is set
  params.apiVersion = ORBIS_API_VERSION.SEARCH;

  // Handle limit vs maxResults
  if (mergedOptions.limit !== undefined) {
    params.limit = mergedOptions.limit;
  } else if (mergedOptions.maxResults !== undefined) {
    params.maxResults = mergedOptions.maxResults;
  }

  // Reverse geocoding specific parameters
  const reverseSpecificParams = [
    "returnSpeedLimit",
    "returnRoadUse",
    "allowFreeformNewLine",
    "returnMatchType",
    "heading",
    "returnRoadAccessibility",
    "returnCommune",
    "returnAddressNames",
  ];

  reverseSpecificParams.forEach((param) => {
    if (mergedOptions[param as keyof ReverseGeocodeOptions] !== undefined) {
      params[param] = mergedOptions[param as keyof ReverseGeocodeOptions];
    }
  });

  // Handle roadUse array separately
  if (roadUse !== undefined) {
    params.roadUse = roadUse.join(",");
  }

  return params;
}

/**
 * Generic API call wrapper with error handling
 */
async function makeApiCall(
  endpoint: string,
  params: Record<string, any>,
  operation: string
): Promise<any> {
  try {
    validateApiKey();
    logger.debug(`${operation} with params: ${JSON.stringify(params)}`);
    const response = await tomtomClient.get(endpoint, { params });
    return response.data;
  } catch (error: any) {
    logger.error(`${operation} error: ${error.message || "Unknown error"}`);
    if (error.response) {
      logger.error(
        `Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data || {})}`
      );
    }
    throw handleApiError(error);
  }
}

/**
 * Searches for places based on a free-text query
 */
export async function searchPlaces(query: string): Promise<SearchResult> {
  const params = buildSearchParams(
    {},
    {
      limit: 10,
      typeahead: true,
      language: "en-US",
    }
  );

  return makeApiCall(
    `/maps/orbis/places/search/${encodeURIComponent(query)}.json`,
    params,
    `Searching for places: "${query}"`
  );
}

/**
 * Performs a fuzzy search for places, addresses, and POIs with advanced options
 */
export async function fuzzySearch(
  query: string,
  options?: ExtendedSearchOptions
): Promise<SearchResult> {
  const params = buildSearchParams(options, {
    limit: 10,
    language: "en-US",
  });

  return makeApiCall(
    `/maps/orbis/places/search/${encodeURIComponent(query)}.json`,
    params,
    `Fuzzy searching for: "${query}"`
  );
}

/**
 * Search specifically for Points of Interest (POIs)
 */
export async function poiSearch(
  query: string,
  options?: ExtendedSearchOptions
): Promise<SearchResult> {
  const params = buildSearchParams(options, {
    limit: 10,
    language: "en-US",
  });

  return makeApiCall(
    `/maps/orbis/places/poiSearch/${encodeURIComponent(query)}.json`,
    params,
    `POI searching for: "${query}"`
  );
}

/**
 * Geocodes an address to coordinates
 */
export async function geocodeAddress(
  query: string,
  options?: BaseSearchOptions
): Promise<SearchResult> {
  const params = buildSearchParams(options, {
    limit: options?.limit || 10,
    language: options?.language || "en-US",
  });

  return makeApiCall(
    `/maps/orbis/places/geocode/${encodeURIComponent(query)}.json`,
    params,
    `Geocoding address: "${query}"`
  );
}

/**
 * Reverse geocodes coordinates to an address
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
  options?: ReverseGeocodeOptions
): Promise<SearchResult | ReverseGeocodingResult> {
  const params = buildReverseGeocodeParams(options, {
    radius: 100,
    language: "en-US",
    limit: 5,
  });

  const apiPath = `/maps/orbis/places/reverseGeocode/${lat},${lon}.json`;
  console.error(`${apiPath}`);
  return makeApiCall(apiPath, params, `Reverse geocoding coordinates: (${lat}, ${lon})`);
}

/**
 * Searches for points of interest (POIs) near a location
 */
export async function searchNearby(
  lat: number,
  lon: number,
  optionsOrCategory?: string | ExtendedSearchOptions,
  radiusParam?: number
): Promise<SearchResult> {
  // Handle backward compatibility
  let options: ExtendedSearchOptions;

  if (typeof optionsOrCategory === "string" || optionsOrCategory === undefined) {
    options = {
      categorySet: optionsOrCategory,
      radius: radiusParam || 1000,
    };
  } else {
    options = optionsOrCategory;
  }

  const params = buildSearchParams(options, {
    radius: 1000,
    limit: 20,
    language: "en-US",
  });

  // Add lat/lon directly since they're required for nearby search
  params.lat = lat;
  params.lon = lon;

  const categoryInfo = options.categorySet
    ? `, category: ${options.categorySet}`
    : ", category: any";
  const radiusInfo = options.radius || 1000;

  return makeApiCall(
    `/maps/orbis/places/nearbySearch/.json`,
    params,
    `Searching nearby: (${lat}, ${lon})${categoryInfo}, radius: ${radiusInfo}m`
  );
}
