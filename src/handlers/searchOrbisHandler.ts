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
  searchInArea,
  searchEVStations,
  searchAlongRoute,
} from "../services/search/searchOrbisService";
import type {
  AreaSearchParams,
  SearchAlongRouteResult,
} from "../services/search/searchOrbisService";
import {
  trimSearchResponse,
  buildCompressedResponse,
  trimGeoJSONFeatureProperties,
  Backend,
} from "./shared/responseTrimmer";
import { generateCirclePoints } from "../services/map/geometryUtils";
import type { SearchResponse } from "@tomtom-org/maps-sdk/services";
import type { Places } from "@tomtom-org/maps-sdk/core";
import type { Feature, Polygon, Position } from "geojson";
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
      // Schema types are more permissive than SDK types (e.g., boundingBox as number[] vs BBox tuple)
      const result = await geocodeAddress(
        query,
        Object.keys(options).length > 0
          ? (options as Parameters<typeof geocodeAddress>[1])
          : undefined
      );

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...(result as object), _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimSearchResponse(result, BACKEND);
      return await buildCompressedResponse(trimmed, result, show_ui);
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
  return async (params: ReverseGeocodeSearchOrbisParams) => {
    const { position, show_ui = true, response_detail = "compact", ...options } = params;
    const pos = position as Position;
    logger.info({ lng: pos[0], lat: pos[1] }, "Reverse geocoding");
    try {
      // Schema types are more permissive than SDK types (e.g., language as string vs Language enum)
      const result = await reverseGeocode(
        pos,
        Object.keys(options).length > 0
          ? (options as Parameters<typeof reverseGeocode>[1])
          : undefined
      );

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...(result as object), _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimSearchResponse(result, BACKEND);
      return await buildCompressedResponse(trimmed, result, show_ui);
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
  return async (params: FuzzySearchOrbisParams) => {
    logger.info("Fuzzy search");
    try {
      const { show_ui = true, response_detail = "compact", ...searchParams } = params;
      // Schema types are more permissive than SDK types (e.g., poiCategories as string[] vs enum[])
      const result = await fuzzySearch(
        searchParams.query,
        searchParams as Parameters<typeof fuzzySearch>[1]
      );

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...(result as object), _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimSearchResponse(result, BACKEND);
      return await buildCompressedResponse(trimmed, result, show_ui);
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
  return async (params: PoiSearchOrbisParams) => {
    logger.info("POI search");
    try {
      const { show_ui = true, response_detail = "compact", ...searchParams } = params;
      // Schema types are more permissive than SDK types (e.g., poiCategories as string[] vs enum[])
      const result = await poiSearch(
        searchParams.query,
        searchParams as Parameters<typeof poiSearch>[1]
      );

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...(result as object), _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimSearchResponse(result, BACKEND);
      return await buildCompressedResponse(trimmed, result, show_ui);
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
  return async (params: NearbySearchOrbisParams) => {
    const { position, show_ui = true, response_detail = "compact", ...options } = params;
    const pos = position as Position;
    logger.info({ lng: pos[0], lat: pos[1] }, "Nearby search");
    try {
      // Schema types are more permissive than SDK types (e.g., poiCategories as string[] vs enum[])
      const result = await searchNearby(pos, options as Parameters<typeof searchNearby>[1]);

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...(result as object), _meta: { show_ui } };
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimSearchResponse(result, BACKEND);
      return await buildCompressedResponse(trimmed, result, show_ui);
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

export function createPOICategoriesHandler() {
  return async (params: PoiCategoriesOrbisParams) => {
    logger.info("POI categories lookup");
    try {
      const { filters } = params;
      const result = await fetchPOICategories(filters);
      const response = { ...result, _meta: { show_ui: false } };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "POI categories lookup failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Area / Geometry Search
// ---------------------------------------------------------------------------

function trimAreaSearchResponse(response: SearchResponse): SearchResponse {
  if (!response?.features) return response;

  const trimmed = structuredClone(response);

  trimmed.features.forEach((feature) => {
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    trimGeoJSONFeatureProperties(props);
  });

  return trimmed;
}

function buildSearchBoundaryFeature(searchParams: AreaSearchParams): Feature<Polygon> | null {
  if (searchParams.polygon && searchParams.polygon.length >= 3) {
    const coordinates = searchParams.polygon.map((p: Position) => [p[0], p[1]]);
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      coordinates.push([...first]);
    }
    return {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [coordinates] },
      properties: { geometryType: "polygon" },
    };
  }

  if (searchParams.center && searchParams.radius) {
    const [centerLon, centerLat] = searchParams.center;
    const points = generateCirclePoints(centerLat, centerLon, searchParams.radius, 64);
    const coordinates = points.map((p) => [p.lon, p.lat]);
    coordinates.push([...coordinates[0]]);
    return {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [coordinates] },
      properties: { geometryType: "circle" },
    };
  }

  if (searchParams.boundingBox) {
    const [[tlLon, tlLat], [brLon, brLat]] = searchParams.boundingBox;
    return {
      type: "Feature",
      geometry: {
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
      },
      properties: { geometryType: "boundingBox" },
    };
  }

  return null;
}

export function createAreaSearchHandler() {
  return async (params: AreaSearchOrbisParams) => {
    logger.info("Area/geometry search");
    try {
      const { show_ui = true, response_detail = "compact", ...searchParams } = params;

      const result = await searchInArea(searchParams as AreaSearchParams);

      const boundary = buildSearchBoundaryFeature(searchParams as AreaSearchParams);
      const resultWithBoundary: SearchResponse & { _searchBoundary?: Feature<Polygon> } = boundary
        ? { ...result, _searchBoundary: boundary }
        : result;

      if (response_detail === "full") {
        const response = { ...resultWithBoundary, _meta: { show_ui } };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
        };
      }

      const trimmed = trimAreaSearchResponse(result);
      return await buildCompressedResponse(trimmed, resultWithBoundary, show_ui);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "Area search failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}

// ---------------------------------------------------------------------------
// EV Charging Station Search
// ---------------------------------------------------------------------------

interface ConnectorInfo {
  connector?: {
    type?: string;
    ratedPowerKW?: number;
    currentType?: string;
    chargingSpeed?: string;
  };
  count?: number;
}

function trimEVSearchResponse(response: Places): Places {
  if (!response?.features) return response;

  const trimmed = structuredClone(response);

  trimmed.features.forEach((feature) => {
    const props = (feature.properties ?? {}) as Record<string, unknown>;

    trimGeoJSONFeatureProperties(props);

    const chargingPark = props.chargingPark as { connectors?: ConnectorInfo[] } | undefined;
    if (chargingPark?.connectors) {
      chargingPark.connectors = chargingPark.connectors.map((c: ConnectorInfo) => ({
        type: c.connector?.type,
        ratedPowerKW: c.connector?.ratedPowerKW,
        currentType: c.connector?.currentType,
        chargingSpeed: c.connector?.chargingSpeed,
        count: c.count,
      })) as ConnectorInfo[];
    }
  });

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
          content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
        };
      }

      const trimmed = trimEVSearchResponse(result);
      return await buildCompressedResponse(trimmed, result, show_ui);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "EV charging station search failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
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

  if (trimmed.route?.features) {
    trimmed.route.features.forEach((feature) => {
      const geom = feature.geometry as { coordinates?: unknown[] } | undefined;
      if (geom?.coordinates) {
        const coords = geom.coordinates;
        if (Array.isArray(coords) && coords.length > 2) {
          geom.coordinates = [coords[0], coords[coords.length - 1]];
        }
      }

      const props = (feature.properties ?? {}) as Record<string, unknown>;
      delete props.sections;
      delete props.progress;
      delete props.guidance;
    });
  }

  if (trimmed.pois?.features) {
    trimmed.pois.features.forEach((feature) => {
      const props = (feature.properties ?? {}) as Record<string, unknown>;
      trimGeoJSONFeatureProperties(props);
    });
  }

  return trimmed;
}

export function createSearchAlongRouteHandler() {
  return async (params: SearchAlongRouteOrbisParams) => {
    logger.info("Search along route");
    try {
      const { show_ui = true, response_detail = "compact", ...searchParams } = params;

      // Schema types are more permissive than SDK types (e.g., poiCategories as string[] vs enum[])
      const result = await searchAlongRoute(searchParams as Parameters<typeof searchAlongRoute>[0]);

      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
        };
      }

      const trimmed = trimSearchAlongRouteResponse(result);
      return await buildCompressedResponse(trimmed, result, show_ui);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "Search along route failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}
