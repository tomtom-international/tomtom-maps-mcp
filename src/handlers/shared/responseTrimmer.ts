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
 *
 * Response trimming and compression utilities for MCP tool responses.
 * Handles backend-specific differences between Genesis and Orbis APIs.
 */

import { gzipSync } from "zlib";

export type Backend = "genesis" | "orbis";

// ============================================================================
// API Response Interfaces (flexible - allow additional properties from real API)
// ============================================================================

/** Routing API response structure */
export interface RoutingResponse {
  routes?: Array<{
    legs?: Array<{
      points?: unknown;
      [key: string]: unknown;
    }>;
    guidance?: unknown;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

/** Search API response structure (geocode, POI, fuzzy, nearby) */
export interface SearchResponse {
  summary?: {
    queryTime?: number;
    fuzzyLevel?: number;
    offset?: number;
    geoBias?: unknown;
    [key: string]: unknown;
  };
  results?: Array<{
    poi?: {
      classifications?: unknown;
      openingHours?: unknown;
      categorySet?: unknown;
      timeZone?: unknown;
      brands?: unknown; // Genesis only
      features?: unknown; // Orbis only
      [key: string]: unknown;
    };
    address?: {
      countryCodeISO3?: string;
      countrySubdivisionCode?: string;
      countrySubdivisionName?: string;
      localName?: string;
      extendedPostalCode?: string; // Genesis only
      [key: string]: unknown;
    };
    dataSources?: unknown;
    matchConfidence?: unknown;
    info?: string;
    viewport?: unknown;
    boundingBox?: unknown;
    [key: string]: unknown;
  }>;
  addresses?: Array<{
    address?: {
      countryCodeISO3?: string;
      countrySubdivisionCode?: string;
      countrySubdivisionName?: string;
      localName?: string;
      boundingBox?: unknown;
      [key: string]: unknown;
    };
    mapcodes?: unknown;
    matchType?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

/** Traffic incidents API response structure */
export interface TrafficResponse {
  incidents?: Array<{
    geometry?: {
      coordinates?: unknown;
      [key: string]: unknown;
    };
    properties?: {
      tmc?: unknown;
      aci?: unknown;
      numberOfReports?: unknown;
      lastReportTime?: unknown;
      probabilityOfOccurrence?: string;
      timeValidity?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

/** Reachable range API response structure */
export interface ReachableRangeResponse {
  reachableRange?: {
    boundary?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** MCP response content structure */
export interface MCPResponseContent {
  type: "text";
  text: string;
}

export interface MCPResponse {
  content: MCPResponseContent[];
  isError?: boolean;
}

/** Deep clone using native structuredClone (faster than JSON.parse/stringify for large objects) */
function deepClone<T>(obj: T): T {
  return structuredClone(obj);
}

/**
 * Trim routing response - removes large coordinate arrays and guidance instructions.
 *
 * COMMON (both backends):
 *   - routes[].legs[].points (50K-75K chars - polyline data for visualization)
 *   - routes[].guidance (turn-by-turn instructions)
 *
 * GENESIS ONLY:
 *   - routes[].sections exists (sectionType, travelMode) - kept as it's small and useful
 *
 * ORBIS ONLY:
 *   - No additional fields to trim
 */
export function trimRoutingResponse(response: unknown, _backend?: Backend): unknown {
  const resp = response as RoutingResponse;
  if (!resp?.routes) return response;

  const trimmed = deepClone(resp);

  trimmed.routes?.forEach((route) => {
    // COMMON: Remove large coordinate arrays from legs (50K-75K chars)
    route.legs?.forEach((leg) => {
      delete leg.points;
    });

    // COMMON: Remove turn-by-turn guidance (can be very large)
    delete route.guidance;

    // Note: Genesis has routes[].sections which is kept (small, useful for travelMode info)
  });

  return trimmed;
}

/**
 * Trim search response - removes verbose POI details and metadata.
 * Handles differences between Genesis and Orbis backends.
 *
 * COMMON (both backends):
 *   - results[].dataSources (geometry IDs - not needed for agent)
 *   - results[].matchConfidence (internal scoring)
 *   - results[].info (internal reference string)
 *   - results[].viewport (map display bounds)
 *   - results[].boundingBox (map display bounds)
 *   - results[].poi.classifications (verbose category data)
 *   - results[].poi.openingHours (detailed hours)
 *   - results[].poi.categorySet (redundant with categories)
 *   - results[].address.countryCodeISO3 (redundant with countryCode)
 *   - results[].address.countrySubdivisionCode (redundant)
 *   - results[].address.localName (usually same as municipality)
 *
 * GENESIS ONLY:
 *   - results[].poi.brands (brand info - only in Genesis)
 *   - results[].address.extendedPostalCode (only in Genesis nearby)
 *
 * ORBIS ONLY:
 *   - results[].poi.features (category grouping - only in Orbis)
 */
export function trimSearchResponse(response: unknown, backend?: Backend): unknown {
  const resp = response as SearchResponse;
  if (!resp) return response;

  const trimmed = deepClone(resp);

  // Trim summary metadata (not useful for agent)
  if (trimmed.summary) {
    delete trimmed.summary.queryTime;
    delete trimmed.summary.fuzzyLevel;
    delete trimmed.summary.offset;
    delete trimmed.summary.geoBias;
  }

  // Trim results array
  trimmed.results?.forEach((result: any) => {
    // COMMON: Remove verbose POI fields
    if (result.poi) {
      delete result.poi.classifications;
      delete result.poi.openingHours;
      delete result.poi.categorySet;
      delete result.poi.timeZone;

      // GENESIS ONLY: Remove brands (only exists in Genesis)
      if (backend === "genesis") {
        delete result.poi.brands;
      }

      // ORBIS ONLY: Remove features (only exists in Orbis)
      if (backend === "orbis") {
        delete result.poi.features;
      }

      // If backend not specified, remove both to be safe
      if (!backend) {
        delete result.poi.brands;
        delete result.poi.features;
      }
    }

    // COMMON: Remove metadata fields
    delete result.dataSources;
    delete result.matchConfidence;
    delete result.info;
    delete result.viewport;
    delete result.boundingBox;

    // COMMON: Remove redundant address fields
    if (result.address) {
      delete result.address.countryCodeISO3;
      delete result.address.countrySubdivisionCode;
      delete result.address.countrySubdivisionName; // duplicate of countrySubdivision
      delete result.address.localName; // usually same as municipality

      // GENESIS ONLY: Remove extendedPostalCode (only in Genesis)
      if (backend === "genesis") {
        delete result.address.extendedPostalCode;
      }
    }
  });

  // Trim addresses array (reverse geocoding)
  trimmed.addresses?.forEach((addr: any) => {
    delete addr.mapcodes;
    delete addr.matchType;

    // Remove redundant address fields
    if (addr.address) {
      delete addr.address.countryCodeISO3;
      delete addr.address.countrySubdivisionCode;
      delete addr.address.countrySubdivisionName;
      delete addr.address.localName;
      delete addr.address.boundingBox;
    }
  });

  return trimmed;
}

/**
 * Trim traffic response - removes geometry coordinates and verbose metadata.
 * Structure is identical between Genesis and Orbis.
 *
 * COMMON (both backends):
 *   - incidents[].geometry.coordinates (large polyline arrays - 500-1000 chars each)
 *   - incidents[].properties.tmc (traffic message channel codes)
 *   - incidents[].properties.aci (internal codes)
 *   - incidents[].properties.numberOfReports (null in most cases)
 *   - incidents[].properties.lastReportTime (null in most cases)
 *   - incidents[].properties.probabilityOfOccurrence (always "certain")
 *   - incidents[].properties.timeValidity (always "present")
 */
export function trimTrafficResponse(response: unknown, _backend?: Backend): unknown {
  const resp = response as TrafficResponse;
  if (!resp) return response;

  const trimmed = deepClone(resp);

  trimmed.incidents?.forEach((incident) => {
    // COMMON: Remove large coordinate arrays (used for map visualization only)
    if (incident.geometry) {
      delete incident.geometry.coordinates;
    }

    // COMMON: Remove verbose metadata
    if (incident.properties) {
      delete incident.properties.tmc;
      delete incident.properties.aci;
      delete incident.properties.numberOfReports;
      delete incident.properties.lastReportTime;
      delete incident.properties.probabilityOfOccurrence;
      delete incident.properties.timeValidity;
    }
  });

  return trimmed;
}

/**
 * Trim reachable range response - removes boundary coordinates.
 * Structure is identical between Genesis and Orbis.
 *
 * COMMON (both backends):
 *   - reachableRange.boundary (large coordinate array - 2K chars)
 */
export function trimReachableRangeResponse(response: unknown, _backend?: Backend): unknown {
  const resp = response as ReachableRangeResponse;
  if (!resp?.reachableRange) return response;

  const trimmed = deepClone(resp);

  // Remove large boundary polygon (only needed for visualization)
  if (trimmed.reachableRange) {
    delete trimmed.reachableRange.boundary;
  }

  return trimmed;
}

/** Gzip compress and base64 encode data */
function compressData(data: any): string {
  return gzipSync(JSON.stringify(data)).toString("base64");
}

/**
 * Build MCP response with trimmed data for agent and compressed full data for Apps.
 */
export function buildCompressedResponse<T>(
  trimmedData: T,
  fullData: T,
  showUI: boolean = true
): MCPResponse {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            ...trimmedData,
            _meta: showUI
              ? { show_ui: true, _compressed: compressData(fullData) }
              : { show_ui: false },
          },
          null,
          2
        ),
      },
    ],
  };
}
