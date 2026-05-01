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
} from "../services/search/searchService";
import { trimSearchResponse, Backend } from "./shared/responseTrimmer";
import type {
  GeocodeSearchParams,
  FuzzySearchParams,
  PoiSearchParams,
  NearbySearchParams,
  ReverseGeocodeSearchParams,
} from "../schemas/search/searchSchema";

const BACKEND: Backend = "genesis";

// Handler factory functions
export function createGeocodeHandler() {
  return async (params: GeocodeSearchParams) => {
    try {
      const { query, response_detail = "compact", ...options } = params;
      const result = await geocodeAddress(
        query,
        Object.keys(options).length > 0 ? options : undefined
      );
      if (response_detail === "full") {
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      }
      const trimmed = trimSearchResponse(result, BACKEND);
      return { content: [{ type: "text" as const, text: JSON.stringify(trimmed, null, 2) }] };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "Geocoding failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}

export function createReverseGeocodeHandler() {
  return async (params: ReverseGeocodeSearchParams) => {
    const { lat, lon, response_detail = "compact", ...options } = params;
    try {
      const result = await reverseGeocode(
        lat,
        lon,
        Object.keys(options).length > 0 ? options : undefined
      );
      if (response_detail === "full") {
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      }
      const trimmed = trimSearchResponse(result, BACKEND);
      return { content: [{ type: "text" as const, text: JSON.stringify(trimmed, null, 2) }] };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "Reverse geocoding failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}

export function createFuzzySearchHandler() {
  return async (params: FuzzySearchParams) => {
    try {
      const { response_detail = "compact", ...searchParams } = params;
      const result = await fuzzySearch(searchParams.query, searchParams);
      if (response_detail === "full") {
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      }
      const trimmed = trimSearchResponse(result, BACKEND);
      return { content: [{ type: "text" as const, text: JSON.stringify(trimmed, null, 2) }] };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "Fuzzy search failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}

export function createPoiSearchHandler() {
  return async (params: PoiSearchParams) => {
    try {
      const { response_detail = "compact", ...searchParams } = params;
      const result = await poiSearch(searchParams.query, searchParams);
      if (response_detail === "full") {
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      }
      const trimmed = trimSearchResponse(result, BACKEND);
      return { content: [{ type: "text" as const, text: JSON.stringify(trimmed, null, 2) }] };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "POI search failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}

export function createNearbySearchHandler() {
  return async (params: NearbySearchParams) => {
    const { lat, lon, response_detail = "compact", ...options } = params;
    try {
      const result = await searchNearby(lat, lon, options);
      if (response_detail === "full") {
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      }
      const trimmed = trimSearchResponse(result, BACKEND);
      return { content: [{ type: "text" as const, text: JSON.stringify(trimmed, null, 2) }] };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "Nearby search failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}
