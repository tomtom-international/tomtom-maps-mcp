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
import { handleApiError, toErrorPayload } from "../utils/apiErrorHandler";
import {
  geocodeAddress,
  reverseGeocode,
  fuzzySearch,
  poiSearch,
  searchNearby,
  fetchPOICategories,
  searchInArea,
  searchEVStations,
  searchAlongRoute,
  toSearchArea,
} from "../services/search/searchOrbisService";
import type {
  AreaSearchParams,
  SearchAlongRouteResult,
} from "../services/search/searchOrbisService";
import {
  trimSearchResponse,
  requestedSearchFields,
  buildCompressedResponse,
  Backend,
} from "./shared/responseTrimmer";
import { generateCirclePoints } from "../services/map/geometryUtils";
import type { SearchResponse } from "@tomtom-org/maps-sdk/services";
import type { Places } from "@tomtom-org/maps-sdk/core";
import type { Feature, Polygon } from "geojson";
import type {
  GeocodeSearchOrbisParams,
  ReverseGeocodeSearchOrbisParams,
  FuzzySearchOrbisParams,
  PoiSearchOrbisParams,
  NearbySearchOrbisParams,
  PoiCategoriesOrbisParams,
  AreaSearchOrbisParams,
  EvSearchOrbisParams,
  SearchAlongRouteOrbisParams,
} from "../schemas/search/searchOrbisSchema";

const BACKEND: Backend = "orbis";

// Handler factory functions
export function createGeocodeHandler() {
  return async (params: GeocodeSearchOrbisParams) => {
    logger.info("Geocoding");
    try {
      const { query, show_ui = true, response_detail = "compact", ...options } = params;
      const result = await geocodeAddress(query, options);

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...(result as object), _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimSearchResponse(result, BACKEND, requestedSearchFields(params));
      return await buildCompressedResponse(trimmed, result, show_ui);
    } catch (error: unknown) {
      const formattedError = handleApiError(error, "Geocoding (Orbis)");
      logger.error({ error: formattedError.message }, "Geocoding failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(toErrorPayload(formattedError)) }],
        isError: true,
      };
    }
  };
}

export function createReverseGeocodeHandler() {
  return async (params: ReverseGeocodeSearchOrbisParams) => {
    const { position: pos, show_ui = true, response_detail = "compact", ...options } = params;
    logger.info({ lng: pos[0], lat: pos[1] }, "Reverse geocoding");
    try {
      const result = await reverseGeocode(pos, options);

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...(result as object), _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimSearchResponse(result, BACKEND, requestedSearchFields(params));
      return await buildCompressedResponse(trimmed, result, show_ui);
    } catch (error: unknown) {
      const formattedError = handleApiError(error, "Reverse geocoding (Orbis)");
      logger.error({ error: formattedError.message }, "Reverse geocoding failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(toErrorPayload(formattedError)) }],
        isError: true,
      };
    }
  };
}

export function createFuzzySearchHandler() {
  return async (params: FuzzySearchOrbisParams) => {
    logger.info("Fuzzy search");
    try {
      const { show_ui = true, response_detail = "compact", ...searchParams } = params;
      const result = await fuzzySearch(searchParams.query, searchParams);

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...(result as object), _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimSearchResponse(result, BACKEND, requestedSearchFields(params));
      return await buildCompressedResponse(trimmed, result, show_ui);
    } catch (error: unknown) {
      const formattedError = handleApiError(error, "Fuzzy search (Orbis)");
      logger.error({ error: formattedError.message }, "Fuzzy search failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(toErrorPayload(formattedError)) }],
        isError: true,
      };
    }
  };
}

export function createPoiSearchHandler() {
  return async (params: PoiSearchOrbisParams) => {
    logger.info("POI search");
    try {
      const { show_ui = true, response_detail = "compact", ...searchParams } = params;
      const result = await poiSearch(searchParams.query, searchParams);

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...(result as object), _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimSearchResponse(result, BACKEND, requestedSearchFields(params));
      return await buildCompressedResponse(trimmed, result, show_ui);
    } catch (error: unknown) {
      const formattedError = handleApiError(error, "POI search (Orbis)");
      logger.error({ error: formattedError.message }, "POI search failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(toErrorPayload(formattedError)) }],
        isError: true,
      };
    }
  };
}

export function createNearbySearchHandler() {
  return async (params: NearbySearchOrbisParams) => {
    const { position: pos, show_ui = true, response_detail = "compact", ...options } = params;
    logger.info({ lng: pos[0], lat: pos[1] }, "Nearby search");
    try {
      const result = await searchNearby(pos, options);

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...(result as object), _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimSearchResponse(result, BACKEND, requestedSearchFields(params));
      return await buildCompressedResponse(trimmed, result, show_ui);
    } catch (error: unknown) {
      const formattedError = handleApiError(error, "Nearby search (Orbis)");
      logger.error({ error: formattedError.message }, "Nearby search failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(toErrorPayload(formattedError)) }],
        isError: true,
      };
    }
  };
}

export function createPOICategoriesHandler() {
  return async (params: PoiCategoriesOrbisParams) => {
    logger.info("POI categories lookup");
    try {
      const { filters } = params;
      const result = await fetchPOICategories(filters);
      const response = { ...result, _meta: { show_ui: false } };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(response) }],
      };
    } catch (error: unknown) {
      const formattedError = handleApiError(error, "POI categories lookup (Orbis)");
      logger.error({ error: formattedError.message }, "POI categories lookup failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(toErrorPayload(formattedError)) }],
        isError: true,
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Area / Geometry Search
// ---------------------------------------------------------------------------

function buildSearchBoundaryFeature(searchParams: AreaSearchParams): Feature<Polygon> | null {
  const area = toSearchArea(searchParams);
  if (!area) return null;

  if (area.kind === "circle") {
    const [centerLon, centerLat] = area.circle.coordinates;
    const points = generateCirclePoints(centerLat, centerLon, area.circle.radius, 64);
    const coordinates = points.map((p) => [p.lon, p.lat]);
    coordinates.push([...coordinates[0]]);
    return {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [coordinates] },
      properties: { geometryType: "circle" },
    };
  }

  return { type: "Feature", geometry: area.polygon, properties: { geometryType: area.kind } };
}

export function createAreaSearchHandler() {
  return async (params: AreaSearchOrbisParams) => {
    logger.info("Area/geometry search");
    try {
      const { show_ui = true, response_detail = "compact", ...searchParams } = params;

      const result = await searchInArea(searchParams);

      const boundary = buildSearchBoundaryFeature(searchParams);
      const resultWithBoundary: SearchResponse & { _searchBoundary?: Feature<Polygon> } = boundary
        ? { ...result, _searchBoundary: boundary }
        : result;

      if (response_detail === "full") {
        const response = { ...resultWithBoundary, _meta: { show_ui } };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(response) }],
        };
      }

      const trimmed = trimSearchResponse(result, BACKEND);
      return await buildCompressedResponse(trimmed, resultWithBoundary, show_ui);
    } catch (error: unknown) {
      const formattedError = handleApiError(error, "Area search (Orbis)");
      logger.error({ error: formattedError.message }, "Area search failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(toErrorPayload(formattedError)) }],
        isError: true,
      };
    }
  };
}

// ---------------------------------------------------------------------------
// EV Charging Station Search
// ---------------------------------------------------------------------------

/** The parts of the SDK's EV availability enrichment that compact reads. */
interface EVAvailability {
  accessType?: string;
  chargingPointAvailability?: { count?: number; statusCounts?: Record<string, number> };
  connectorAvailabilities?: Array<{
    connector?: { type?: string; ratedPowerKW?: number };
    statusCounts?: Record<string, number>;
  }>;
}

/** The parts of an EV search chargingPark that compact reads. */
interface EVChargingPark {
  connectors?: Array<{ type?: string; ratedPowerKW?: number; [key: string]: unknown }>;
  availability?: EVAvailability;
}

/**
 * Real-time availability enrichment returns a verbose object (per-point
 * detail). For the agent, keep who may charge (accessType), the aggregated
 * counts/status summary (total + Available/Occupied/Reserved/OutOfService),
 * and each connector type's statusCounts on its connector entry, which answers
 * "is a CCS plug free?". Full detail remains available via response_detail:"full".
 */
function trimEVAvailability(chargingPark: EVChargingPark): void {
  const availability = chargingPark.availability;
  if (!availability) return;

  for (const connector of chargingPark.connectors ?? []) {
    const match = availability.connectorAvailabilities?.find(
      (a) =>
        a.connector?.type === connector.type && a.connector?.ratedPowerKW === connector.ratedPowerKW
    );
    if (match?.statusCounts) connector.statusCounts = match.statusCounts;
  }

  const cpa = availability.chargingPointAvailability;
  if (!cpa && !availability.accessType) {
    delete chargingPark.availability;
    return;
  }
  chargingPark.availability = {
    ...(availability.accessType ? { accessType: availability.accessType } : {}),
    ...(cpa
      ? { chargingPointAvailability: { count: cpa.count, statusCounts: cpa.statusCounts } }
      : {}),
  };
}

function trimEVSearchResponse(response: Places): Places {
  if (!response?.features) return response;

  // Shared search trim (collection summary and features), which also flattens
  // chargingPark.connectors
  const trimmed = trimSearchResponse(response, BACKEND) as Places;

  for (const feature of trimmed.features) {
    const chargingPark = feature.properties?.chargingPark as EVChargingPark | undefined;
    if (chargingPark) trimEVAvailability(chargingPark);
  }

  return trimmed;
}

export function createEVSearchHandler() {
  return async (params: EvSearchOrbisParams) => {
    logger.info("EV charging station search");
    try {
      const { show_ui = true, response_detail = "compact", ...searchParams } = params;

      const result = await searchEVStations(searchParams);

      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(response) }],
        };
      }

      const trimmed = trimEVSearchResponse(result);
      return await buildCompressedResponse(trimmed, result, show_ui);
    } catch (error: unknown) {
      const formattedError = handleApiError(error, "EV search (Orbis)");
      logger.error({ error: formattedError.message }, "EV charging station search failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(toErrorPayload(formattedError)) }],
        isError: true,
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Search Along Route
// ---------------------------------------------------------------------------

function trimSearchAlongRouteResponse(response: SearchAlongRouteResult): SearchAlongRouteResult {
  const trimmed = structuredClone(response);
  // Same search trim as the other search tools (collection summary and features)
  if (trimmed.pois?.features) {
    trimmed.pois = trimSearchResponse(trimmed.pois, BACKEND) as SearchAlongRouteResult["pois"];
  }

  if (trimmed.route?.features) {
    trimmed.route.features.forEach((feature) => {
      const geom = feature.geometry as { coordinates?: unknown[] } | undefined;
      if (geom?.coordinates) {
        const coords = geom.coordinates;
        if (Array.isArray(coords) && coords.length > 2) {
          geom.coordinates = [coords[0], coords[coords.length - 1]];
        }
      }

      // Map display bounds, as in routing
      delete (feature as { bbox?: unknown }).bbox;

      const props = (feature.properties ?? {}) as Record<string, unknown>;
      delete props.sections;
      delete props.progress;
      delete props.guidance;
    });
  }

  return trimmed;
}

export function createSearchAlongRouteHandler() {
  return async (params: SearchAlongRouteOrbisParams) => {
    logger.info("Search along route");
    try {
      const { show_ui = true, response_detail = "compact", ...searchParams } = params;

      const result = await searchAlongRoute(searchParams);

      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(response) }],
        };
      }

      const trimmed = trimSearchAlongRouteResponse(result);
      return await buildCompressedResponse(trimmed, result, show_ui);
    } catch (error: unknown) {
      const formattedError = handleApiError(error, "Search along route (Orbis)");
      logger.error({ error: formattedError.message }, "Search along route failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(toErrorPayload(formattedError)) }],
        isError: true,
      };
    }
  };
}
