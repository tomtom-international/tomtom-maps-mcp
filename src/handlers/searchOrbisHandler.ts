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
  fetchPOICategories,
} from "../services/search/searchOrbisService";
import { trimSearchResponse, buildCompressedResponse, Backend } from "./shared/responseTrimmer";
import type { Position } from "geojson";

const BACKEND: Backend = "orbis";

// Handler factory functions
export function createGeocodeHandler() {
  return async (params: Record<string, unknown>) => {
    logger.info("🏠 Geocoding");
    try {
      const { query, show_ui = true, response_detail = "compact", ...options } = params;
      const result = await geocodeAddress(
        query as string,
        Object.keys(options).length > 0 ? options : undefined
      );
      logger.info("✅ Geocoding successful");

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...(result as object), _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimSearchResponse(result, BACKEND);
      return await buildCompressedResponse(trimmed, result, show_ui as boolean);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "❌ Geocoding failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}

export function createReverseGeocodeHandler() {
  return async (params: Record<string, unknown>) => {
    const { position, show_ui = true, response_detail = "compact", ...options } = params;
    const pos = position as Position;
    logger.info({ lng: pos[0], lat: pos[1] }, "📍 Reverse geocoding");
    try {
      const result = await reverseGeocode(
        pos,
        Object.keys(options).length > 0 ? options : undefined
      );
      logger.info("✅ Reverse geocoding successful");

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...(result as object), _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimSearchResponse(result, BACKEND);
      return await buildCompressedResponse(trimmed, result, show_ui as boolean);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "❌ Reverse geocoding failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}

export function createFuzzySearchHandler() {
  return async (params: Record<string, unknown>) => {
    logger.info("🔍 Fuzzy search");
    try {
      const { show_ui = true, response_detail = "compact", ...searchParams } = params;
      const result = await fuzzySearch(searchParams.query as string, searchParams);
      logger.info("✅ Fuzzy search completed");

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...(result as object), _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimSearchResponse(result, BACKEND);
      return await buildCompressedResponse(trimmed, result, show_ui as boolean);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "❌ Fuzzy search failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}

export function createPoiSearchHandler() {
  return async (params: Record<string, unknown>) => {
    logger.info("🏪 POI search");
    try {
      const { show_ui = true, response_detail = "compact", ...searchParams } = params;
      const result = await poiSearch(searchParams.query as string, searchParams);
      logger.info("✅ POI search completed");

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...(result as object), _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimSearchResponse(result, BACKEND);
      return await buildCompressedResponse(trimmed, result, show_ui as boolean);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "❌ POI search failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}

export function createNearbySearchHandler() {
  return async (params: Record<string, unknown>) => {
    const { position, show_ui = true, response_detail = "compact", ...options } = params;
    const pos = position as Position;
    const category = options.poiCategories;
    logger.info(
      { lng: pos[0], lat: pos[1], category: category || "any", radius: options.radius || 1000 },
      "🔍 Nearby search"
    );
    try {
      const result = await searchNearby(pos, options);
      logger.info("✅ Nearby search completed");

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...(result as object), _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimSearchResponse(result, BACKEND);
      return await buildCompressedResponse(trimmed, result, show_ui as boolean);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "❌ Nearby search failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}

export function createPOICategoriesHandler() {
  return async (params: Record<string, unknown>) => {
    logger.info("📂 POI categories lookup");
    try {
      const filters = params.filters as string[] | undefined;
      const result = await fetchPOICategories(filters);
      logger.info({ count: result.poiCategories?.length ?? 0 }, "✅ POI categories retrieved");
      const response = { ...result, _meta: { show_ui: false } };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "❌ POI categories lookup failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}
