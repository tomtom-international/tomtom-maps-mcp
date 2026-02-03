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
import {
  generateVisualizationId,
  cacheVisualizationData,
  getVisualizationData,
  trimSearchResponse,
} from "./shared/visualizationCache";

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

      // If full response requested, return without trimming
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      }

      // Cache full data for App visualization, return trimmed for Agent
      const visualizationId = generateVisualizationId();
      cacheVisualizationData(visualizationId, result);

      const trimmed = trimSearchResponse(result);
      const response = { ...trimmed, _meta: { show_ui, visualizationId } };
      return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
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

      // If full response requested, return without trimming
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      }

      // Cache full data for App visualization, return trimmed for Agent
      const visualizationId = generateVisualizationId();
      cacheVisualizationData(visualizationId, result);

      const trimmed = trimSearchResponse(result);
      const response = { ...trimmed, _meta: { show_ui, visualizationId } };
      return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
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

      // If full response requested, return without trimming
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      }

      // Cache full data for App visualization, return trimmed for Agent
      const visualizationId = generateVisualizationId();
      cacheVisualizationData(visualizationId, result);

      const trimmed = trimSearchResponse(result);
      const response = { ...trimmed, _meta: { show_ui, visualizationId } };
      return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
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

      // If full response requested, return without trimming
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      }

      // Cache full data for App visualization, return trimmed for Agent
      const visualizationId = generateVisualizationId();
      cacheVisualizationData(visualizationId, result);

      const trimmed = trimSearchResponse(result);
      const response = { ...trimmed, _meta: { show_ui, visualizationId } };
      return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
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

      // If full response requested, return without trimming
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      }

      // Cache full data for App visualization, return trimmed for Agent
      const visualizationId = generateVisualizationId();
      cacheVisualizationData(visualizationId, result);

      const trimmed = trimSearchResponse(result);
      const response = { ...trimmed, _meta: { show_ui, visualizationId } };
      return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
    } catch (error: any) {
      logger.error({ error: error.message }, "❌ Nearby search failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}

/**
 * Handler for fetching full search visualization data.
 * This tool is hidden from the Agent (visibility: ["app"]) and only callable by the App.
 */
export function createSearchVisualizationDataHandler() {
  return async (params: { visualizationId: string }) => {
    const { visualizationId } = params;
    logger.info({ visualizationId }, "📊 Fetching search visualization data");

    const data = getVisualizationData(visualizationId);

    if (!data) {
      logger.warn({ visualizationId }, "⚠️ Search visualization data not found or expired");
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: "Visualization data not found or expired" }),
          },
        ],
        isError: true,
      };
    }

    logger.info("✅ Search visualization data retrieved");
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  };
}
