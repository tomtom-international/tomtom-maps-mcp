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
 */

import { logger } from "../utils/logger";
import {
  geocodeAddress,
  reverseGeocode,
  fuzzySearch,
  poiSearch,
  searchNearby,
} from "../services/search/searchOrbisService";
import { trimSearchResponse, buildCompressedResponse, Backend } from "./shared/responseTrimmer";

const BACKEND: Backend = "orbis";

// Handler factory functions
export function createGeocodeHandler() {
  return async (params: any) => {
    logger.info("🏠 Geocoding");
    try {
      const { query, show_ui = true, response_detail = "compact", ...options } = params;
      const result = await geocodeAddress(
        query,
        Object.keys(options).length > 0 ? options : undefined
      );
      logger.info("✅ Geocoding successful");

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimSearchResponse(result, BACKEND);
      return await buildCompressedResponse(trimmed, result, show_ui);
    } catch (error: any) {
      logger.error({ error: error.message }, "❌ Geocoding failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}

export function createReverseGeocodeHandler() {
  return async (params: any) => {
    const { lat, lon, show_ui = true, response_detail = "compact", ...options } = params;
    logger.info({ lat, lon }, "📍 Reverse geocoding");
    try {
      const result = await reverseGeocode(
        lat,
        lon,
        Object.keys(options).length > 0 ? options : undefined
      );
      logger.info("✅ Reverse geocoding successful");

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimSearchResponse(result, BACKEND);
      return await buildCompressedResponse(trimmed, result, show_ui);
    } catch (error: any) {
      logger.error({ error: error.message }, "❌ Reverse geocoding failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}

export function createFuzzySearchHandler() {
  return async (params: any) => {
    logger.info("🔍 Fuzzy search");
    try {
      const { show_ui = true, response_detail = "compact", ...searchParams } = params;
      const result = await fuzzySearch(searchParams.query, searchParams);
      logger.info("✅ Fuzzy search completed");

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimSearchResponse(result, BACKEND);
      return await buildCompressedResponse(trimmed, result, show_ui);
    } catch (error: any) {
      logger.error({ error: error.message }, "❌ Fuzzy search failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}

export function createPoiSearchHandler() {
  return async (params: any) => {
    logger.info("🏪 POI search");
    try {
      const { show_ui = true, response_detail = "compact", ...searchParams } = params;
      const result = await poiSearch(searchParams.query, searchParams);
      logger.info("✅ POI search completed");

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimSearchResponse(result, BACKEND);
      return await buildCompressedResponse(trimmed, result, show_ui);
    } catch (error: any) {
      logger.error({ error: error.message }, "❌ POI search failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}

export function createNearbySearchHandler() {
  return async (params: any) => {
    const { lat, lon, show_ui = true, response_detail = "compact", ...options } = params;
    const category = options.categorySet;
    logger.info(
      { lat, lon, category: category || "any", radius: options.radius || 1000 },
      "🔍 Nearby search"
    );
    try {
      const result = await searchNearby(lat, lon, options);
      logger.info("✅ Nearby search completed");

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimSearchResponse(result, BACKEND);
      return await buildCompressedResponse(trimmed, result, show_ui);
    } catch (error: any) {
      logger.error({ error: error.message }, "❌ Nearby search failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}
