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

import { logger } from "../utils/logger";
import {
  geocodeAddress,
  reverseGeocode,
  fuzzySearch,
  poiSearch,
  searchNearby,
} from "../services/search/searchOrbisService";

// Handler factory functions
export function createGeocodeHandler() {
  return async (params: any) => {
    logger.info(`🏠 Geocoding: "${params.query}"`);
    try {
      const { query, ...options } = params;
      const result = await geocodeAddress(
        query,
        Object.keys(options).length > 0 ? options : undefined
      );
      logger.info(`✅ Geocoding successful for: "${query}"`);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error: any) {
      logger.error(`❌ Geocoding failed: ${error.message}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}

export function createReverseGeocodeHandler() {
  return async (params: any) => {
    const { lat, lon, ...options } = params;
    logger.info(`📍 Reverse geocoding: (${lat}, ${lon})`);
    try {
      const result = await reverseGeocode(
        lat,
        lon,
        Object.keys(options).length > 0 ? options : undefined
      );
      logger.info(`✅ Reverse geocoding successful`);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error: any) {
      logger.error(`❌ Reverse geocoding failed: ${error.message}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}

export function createFuzzySearchHandler() {
  return async (params: any) => {
    logger.info(`🔍 Fuzzy search: "${params.query}"`);
    try {
      const result = await fuzzySearch(params.query, params);
      logger.info(`✅ Fuzzy search completed`);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error: any) {
      logger.error(`❌ Fuzzy search failed: ${error.message}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}

export function createPoiSearchHandler() {
  return async (params: any) => {
    logger.info(`🏪 POI search: "${params.query}"`);
    try {
      const result = await poiSearch(params.query, params);
      logger.info(`✅ POI search completed`);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error: any) {
      logger.error(`❌ POI search failed: ${error.message}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}

export function createNearbySearchHandler() {
  return async (params: any) => {
    const { lat, lon, ...options } = params;
    const category = options.categorySet;
    logger.info(
      `🔍 Nearby search: (${lat}, ${lon}), category: ${category || "any"}, radius: ${options.radius || 1000}m`
    );
    try {
      const result = await searchNearby(lat, lon, options);
      logger.info(`✅ Nearby search completed`);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error: any) {
      logger.error(`❌ Nearby search failed: ${error.message}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}
