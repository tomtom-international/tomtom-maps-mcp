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
  requestedSearchFields,
  buildErrorResponse,
  buildToolResponse,
  type RequestedFields,
} from "./shared/responseTrimmer";
import { boundaryFeature, routeFeaturesFromGeoJSON } from "./shared/geometryResponse";
import { generateCirclePoints } from "../services/map/geometryUtils";
import type { SearchResponse } from "@tomtom-org/maps-sdk/services";
import type { ChargingStationsAvailability, Places } from "@tomtom-org/maps-sdk/core";
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

      return buildToolResponse(
        result,
        (r) => trimSearchResponse(r, requestedSearchFields(params)),
        {
          showUI: show_ui,
          responseDetail: response_detail,
        }
      );
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

      return buildToolResponse(
        result,
        (r) => trimSearchResponse(r, requestedSearchFields(params)),
        {
          showUI: show_ui,
          responseDetail: response_detail,
        }
      );
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

      return buildToolResponse(
        result,
        (r) => trimSearchResponse(r, requestedSearchFields(params)),
        {
          showUI: show_ui,
          responseDetail: response_detail,
        }
      );
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

      return buildToolResponse(
        result,
        (r) => trimEVSearchResponse(r, requestedSearchFields(params)),
        {
          showUI: show_ui,
          responseDetail: response_detail,
        }
      );
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

      return buildToolResponse(
        result,
        (r) => trimSearchResponse(r, requestedSearchFields(params)),
        {
          showUI: show_ui,
          responseDetail: response_detail,
        }
      );
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
        content: [{ type: "text" as const, text: JSON.stringify(response) }],
      };
    } catch (error: unknown) {
      return buildErrorResponse(error, "POI categories lookup");
    }
  };
}

// ---------------------------------------------------------------------------
// Area / Geometry Search
// ---------------------------------------------------------------------------

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

      return buildToolResponse(resultWithBoundary, () => trimSearchResponse(result), {
        showUI: show_ui,
        responseDetail: response_detail,
        geometry: () => boundaryFeature(boundary),
      });
    } catch (error: unknown) {
      return buildErrorResponse(error, "Area search");
    }
  };
}

// ---------------------------------------------------------------------------
// EV Charging Station Search
// ---------------------------------------------------------------------------

/** The parts of the SDK's EV availability enrichment that compact reads or keeps. */
type EVAvailability = Partial<
  Pick<
    ChargingStationsAvailability,
    "accessType" | "chargingPointAvailability" | "connectorAvailabilities"
  >
>;

/**
 * An EV search chargingPark after the shared trim, which flattens each
 * connector to { type, ratedPowerKW, ..., count } (see flattenConnectors).
 */
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

/** The shared search trim (which flattens chargingPark.connectors), then each park's availability. */
function trimEVSearchResponse(response: Places, requested?: RequestedFields): Places {
  if (!response?.features) return response;
  const trimmed = trimSearchResponse(response, requested) as Places;

  for (const feature of trimmed.features) {
    const chargingPark = feature.properties?.chargingPark as EVChargingPark | undefined;
    if (chargingPark) trimEVAvailability(chargingPark);
  }

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
  // Same search trim as the other search tools (collection summary and features)
  if (trimmed.pois?.features) {
    trimmed.pois = trimSearchResponse(trimmed.pois) as SearchAlongRouteResult["pois"];
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
  return async (params: SearchAlongRouteParams) => {
    logger.info("Search along route");
    try {
      const { show_ui = true, response_detail = "compact", ...searchParams } = params;

      const result = await searchAlongRoute(searchParams);

      return buildToolResponse(result, trimSearchAlongRouteResponse, {
        showUI: show_ui,
        responseDetail: response_detail,
        geometry: (r) => routeFeaturesFromGeoJSON(r.route),
      });
    } catch (error: unknown) {
      return buildErrorResponse(error, "Search along route");
    }
  };
}
