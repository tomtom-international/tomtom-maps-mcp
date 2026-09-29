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
} from "../services/search/searchService";
import type { AreaSearchOptions, SearchAlongRouteResult } from "../services/search/searchService";
import { logger } from "../utils/logger";
import {
  trimSearchResponse,
  buildErrorResponse,
  buildToolResponse,
  trimGeoJSONFeatureProperties,
} from "./shared/responseTrimmer";
import { generateCirclePoints } from "../services/map/geometryUtils";
import type { SearchResponse } from "@tomtom-org/maps-sdk/services";
import type { Places } from "@tomtom-org/maps-sdk/core";
import type { Feature, Polygon } from "geojson";
import type {
  GeocodeSearchParams,
  ReverseGeocodeSearchParams,
  FuzzySearchParams,
  PoiSearchParams,
  NearbySearchParams,
  PoiCategoriesParams,
  AreaSearchParams,
  EvSearchParams,
  SearchAlongRouteParams,
} from "../schemas/search/searchSchema";

// Handler factory functions
export function createGeocodeHandler() {
  return async (params: GeocodeSearchParams) => {
    logger.info("Geocoding");
    try {
      const { query, show_ui = true, response_detail = "compact", ...options } = params;
      const result = await geocodeAddress(query, options);

      return buildToolResponse(result, trimSearchResponse, {
        showUI: show_ui,
        responseDetail: response_detail,
      });
    } catch (error: unknown) {
      return buildErrorResponse(error, "Geocoding");
    }
  };
}

export function createReverseGeocodeHandler() {
  return async (params: ReverseGeocodeSearchParams) => {
    const { position: pos, show_ui = true, response_detail = "compact", ...options } = params;
    logger.info({ lng: pos[0], lat: pos[1] }, "Reverse geocoding");
    try {
      const result = await reverseGeocode(pos, options);

      return buildToolResponse(result, trimSearchResponse, {
        showUI: show_ui,
        responseDetail: response_detail,
      });
    } catch (error: unknown) {
      return buildErrorResponse(error, "Reverse geocoding");
    }
  };
}

export function createFuzzySearchHandler() {
  return async (params: FuzzySearchParams) => {
    logger.info("Fuzzy search");
    try {
      const { show_ui = true, response_detail = "compact", ...searchParams } = params;
      const result = await fuzzySearch(searchParams.query, searchParams);

      return buildToolResponse(result, trimSearchResponse, {
        showUI: show_ui,
        responseDetail: response_detail,
      });
    } catch (error: unknown) {
      return buildErrorResponse(error, "Fuzzy search");
    }
  };
}

export function createPoiSearchHandler() {
  return async (params: PoiSearchParams) => {
    logger.info("POI search");
    try {
      const { show_ui = true, response_detail = "compact", ...searchParams } = params;
      const result = await poiSearch(searchParams.query, searchParams);

      return buildToolResponse(result, trimSearchResponse, {
        showUI: show_ui,
        responseDetail: response_detail,
      });
    } catch (error: unknown) {
      return buildErrorResponse(error, "POI search");
    }
  };
}

export function createNearbySearchHandler() {
  return async (params: NearbySearchParams) => {
    const { position: pos, show_ui = true, response_detail = "compact", ...options } = params;
    logger.info({ lng: pos[0], lat: pos[1] }, "Nearby search");
    try {
      const result = await searchNearby(pos, options);

      return buildToolResponse(result, trimSearchResponse, {
        showUI: show_ui,
        responseDetail: response_detail,
      });
    } catch (error: unknown) {
      return buildErrorResponse(error, "Nearby search");
    }
  };
}

export function createPOICategoriesHandler() {
  return async (params: PoiCategoriesParams) => {
    logger.info("POI categories lookup");
    try {
      const { filters } = params;
      const result = await fetchPOICategories(filters);
      const response = { ...result, _meta: { show_ui: false } };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
      };
    } catch (error: unknown) {
      return buildErrorResponse(error, "POI categories lookup");
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

function buildSearchBoundaryFeature(searchParams: AreaSearchOptions): Feature<Polygon> | null {
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
  return async (params: AreaSearchParams) => {
    logger.info("Area/geometry search");
    try {
      const { show_ui = true, response_detail = "compact", ...searchParams } = params;

      const result = await searchInArea(searchParams);

      const boundary = buildSearchBoundaryFeature(searchParams);
      const resultWithBoundary: SearchResponse & { _searchBoundary?: Feature<Polygon> } = boundary
        ? { ...result, _searchBoundary: boundary }
        : result;

      return buildToolResponse(resultWithBoundary, () => trimAreaSearchResponse(result), {
        showUI: show_ui,
        responseDetail: response_detail,
      });
    } catch (error: unknown) {
      return buildErrorResponse(error, "Area search");
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

    const chargingPark = props.chargingPark as
      | {
          connectors?: ConnectorInfo[];
          availability?: {
            chargingPointAvailability?: { count?: number; statusCounts?: Record<string, number> };
          };
        }
      | undefined;
    if (chargingPark?.connectors) {
      chargingPark.connectors = chargingPark.connectors.map((c: ConnectorInfo) => ({
        type: c.connector?.type,
        ratedPowerKW: c.connector?.ratedPowerKW,
        currentType: c.connector?.currentType,
        chargingSpeed: c.connector?.chargingSpeed,
        count: c.count,
      })) as ConnectorInfo[];
    }

    // Real-time availability enrichment returns a verbose object (per-point
    // detail). For the agent, keep only the aggregated counts/status summary
    // (total + Available/Occupied/Reserved/OutOfService). Full detail remains
    // available via response_detail:"full".
    if (chargingPark?.availability) {
      const cpa = chargingPark.availability.chargingPointAvailability;
      if (cpa) {
        chargingPark.availability = {
          chargingPointAvailability: { count: cpa.count, statusCounts: cpa.statusCounts },
        };
      } else {
        delete chargingPark.availability;
      }
    }
  });

  return trimmed;
}

export function createEVSearchHandler() {
  return async (params: EvSearchParams) => {
    logger.info("EV charging station search");
    try {
      const { show_ui = true, response_detail = "compact", ...searchParams } = params;

      const result = await searchEVStations(searchParams);

      return buildToolResponse(result, trimEVSearchResponse, {
        showUI: show_ui,
        responseDetail: response_detail,
      });
    } catch (error: unknown) {
      return buildErrorResponse(error, "EV search");
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
  return async (params: SearchAlongRouteParams) => {
    logger.info("Search along route");
    try {
      const { show_ui = true, response_detail = "compact", ...searchParams } = params;

      const result = await searchAlongRoute(searchParams);

      return buildToolResponse(result, trimSearchAlongRouteResponse, {
        showUI: show_ui,
        responseDetail: response_detail,
      });
    } catch (error: unknown) {
      return buildErrorResponse(error, "Search along route");
    }
  };
}
