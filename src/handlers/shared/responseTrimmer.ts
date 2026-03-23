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

import { storeVizData } from "../../services/cache/vizCache";

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

/** Reachable range response (SDK GeoJSON PolygonFeature or legacy REST) */
export interface ReachableRangeResponse {
  // SDK format: GeoJSON PolygonFeature
  type?: string;
  geometry?: {
    type?: string;
    coordinates?: unknown;
    [key: string]: unknown;
  };
  // Legacy REST format
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
  [key: string]: unknown;
}

/** Deep clone using native structuredClone (faster than JSON.parse/stringify for large objects) */
function deepClone<T>(obj: T): T {
  return structuredClone(obj);
}

// ============================================================================
// Shared GeoJSON Feature Trimming (Orbis SDK responses)
// ============================================================================

/**
 * Trim verbose properties from a GeoJSON Feature's properties object.
 * Used by all Orbis search-related tools (geocode, fuzzy, POI, nearby, area, EV, along-route).
 *
 * Removes:
 *   - POI: classifications, categorySet, categoryIds, timeZone, features, brands, openingHours
 *   - Metadata: dataSources, matchConfidence, info, score, viewport, boundingBox, entryPoints
 *   - Address: countryCodeISO3, countrySubdivisionCode, countrySubdivisionName, localName, extendedPostalCode
 *   - Other: mapcodes, addressRanges, relatedPois
 *
 * Keeps:
 *   - POI: name, phone, url, categories
 *   - Address: freeformAddress, streetName, streetNumber, municipality, postalCode, countryCode, country, countrySubdivision
 *   - Core: type, distance, chargingPark, geometry
 */
export function trimGeoJSONFeatureProperties(props: Record<string, unknown>): void {
  // Trim POI verbose fields
  const poi = props.poi as Record<string, unknown> | undefined;
  if (poi) {
    delete poi.classifications;
    delete poi.categorySet;
    delete poi.categoryIds;
    delete poi.timeZone;
    delete poi.features;
    delete poi.brands;
    delete poi.openingHours;
  }

  // Remove metadata fields (not useful for agent reasoning)
  delete props.dataSources;
  delete props.matchConfidence;
  delete props.info;
  delete props.score;
  delete props.viewport;
  delete props.boundingBox;
  delete props.entryPoints;
  delete props.mapcodes;
  delete props.addressRanges;
  delete props.relatedPois;

  // Trim redundant address fields
  const address = props.address as Record<string, unknown> | undefined;
  if (address) {
    delete address.countryCodeISO3;
    delete address.countrySubdivisionCode;
    delete address.countrySubdivisionName;
    delete address.localName;
    delete address.extendedPostalCode;
  }
}

/**
 * Trim FeatureCollection-level metadata (Orbis SDK search responses).
 * Removes query timing and internal metadata, keeps result counts.
 */
function trimFeatureCollectionMetadata(resp: Record<string, unknown>): void {
  delete resp.queryTime;
  delete resp.geoBias;
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
 * ORBIS SDK FORMAT (GeoJSON FeatureCollection):
 *   - features[].geometry.coordinates (full route polyline)
 *   - features[].properties.guidance (turn-by-turn instructions)
 *   - features[].properties.sections[].geometry (section geometry)
 */
export function trimRoutingResponse(response: unknown, _backend?: Backend): unknown {
  if (!response) return response;
  const resp = response as Record<string, unknown>;

  // SDK format: GeoJSON FeatureCollection with features[]
  if (Array.isArray(resp?.features)) {
    const trimmed = deepClone(resp);
    (trimmed.features as Array<Record<string, unknown>>)?.forEach((feature) => {
      // Remove full route geometry (coordinates array - large polyline)
      const geom = feature.geometry as Record<string, unknown> | undefined;
      if (geom) {
        delete geom.coordinates;
      }
      // Remove feature-level bbox (map display bounds)
      delete feature.bbox;

      // Remove guidance (turn-by-turn instructions) and other verbose fields
      const props = feature.properties as Record<string, unknown> | undefined;
      if (props) {
        delete props.guidance;
        delete props.progress;
        // Remove per-section geometry and verbose section types not useful for an AI agent
        const sections = props.sections as Record<string, unknown> | undefined;
        if (sections && typeof sections === "object") {
          // These section types are map-rendering / point-index data with no actionable info for an agent
          const SECTIONS_TO_STRIP = [
            "roadShields",
            "speedLimit",
            "urban",
            "tunnel",
            "lowEmissionZone",
            "pedestrian",
            "vehicleRestricted",
          ];
          for (const key of SECTIONS_TO_STRIP) {
            delete sections[key];
          }
          // Remove geometry from any remaining sections
          for (const value of Object.values(sections)) {
            if (Array.isArray(value)) {
              value.forEach((section: Record<string, unknown>) => {
                delete section.geometry;
              });
            }
          }
        }
      }
    });
    return trimmed;
  }

  // Legacy REST format: { routes[] }
  const legacyResp = resp as RoutingResponse;
  if (!legacyResp?.routes) return response;

  const trimmed = deepClone(legacyResp);
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
 * ORBIS SDK FORMAT (GeoJSON FeatureCollection):
 *   - features[].properties verbose fields are already stripped by the SDK
 */
export function trimSearchResponse(response: unknown, backend?: Backend): unknown {
  if (!response) return response;
  const resp = response as Record<string, unknown>;

  // SDK format: GeoJSON FeatureCollection with features[] (orbis backend)
  if (Array.isArray(resp?.features)) {
    const trimmed = deepClone(resp);

    // Trim FeatureCollection-level metadata
    trimFeatureCollectionMetadata(trimmed);

    // Trim each feature's properties
    (trimmed.features as Array<Record<string, unknown>>).forEach((feature) => {
      const props = feature.properties as Record<string, unknown> | undefined;
      if (props) {
        trimGeoJSONFeatureProperties(props);
      }
    });

    return trimmed;
  }

  // SDK format: single GeoJSON Feature (reverse geocode)
  if (resp?.type === "Feature" && resp?.properties) {
    const trimmed = deepClone(resp);
    const props = trimmed.properties as Record<string, unknown>;
    if (props) {
      trimGeoJSONFeatureProperties(props);
    }
    return trimmed;
  }

  // Legacy REST format: { summary, results[], addresses[] }
  const legacyResp = resp as SearchResponse;
  const trimmed = deepClone(legacyResp);

  // Trim summary metadata (not useful for agent)
  if (trimmed.summary) {
    delete trimmed.summary.queryTime;
    delete trimmed.summary.fuzzyLevel;
    delete trimmed.summary.offset;
    delete trimmed.summary.geoBias;
  }

  // Trim results array
  trimmed.results?.forEach((result) => {
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
  trimmed.addresses?.forEach((addr) => {
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
 *
 * SDK format (GeoJSON FeatureCollection from calculateReachableRanges):
 *   - features[].geometry.coordinates (large polygon boundary arrays)
 *   - features[].properties (SDK input params — not needed by agent)
 *   - bbox (overall bounds)
 *
 * SDK format (single GeoJSON PolygonFeature):
 *   - geometry.coordinates (large polygon boundary array)
 *   - properties (SDK input params — not needed by agent)
 *
 * Legacy REST format:
 *   - reachableRange.boundary (large coordinate array)
 */
export function trimReachableRangeResponse(response: unknown, _backend?: Backend): unknown {
  const resp = response as ReachableRangeResponse;
  if (!resp) return response;

  const trimmed = deepClone(resp);

  // SDK format: GeoJSON FeatureCollection (from calculateReachableRanges plural)
  if (
    trimmed.type === "FeatureCollection" &&
    Array.isArray((trimmed as Record<string, unknown>).features)
  ) {
    const fc = trimmed as Record<string, unknown>;
    (fc.features as Array<Record<string, unknown>>)?.forEach((feature) => {
      const geom = feature.geometry as Record<string, unknown> | undefined;
      if (geom) delete geom.coordinates;
      delete feature.properties;
    });
    delete fc.bbox;
    return trimmed;
  }

  // SDK format: single GeoJSON PolygonFeature
  if (trimmed.type === "Feature" && trimmed.geometry) {
    // Remove large polygon coordinates (only needed for visualization)
    delete trimmed.geometry.coordinates;
    // Remove SDK input params from properties (not useful to agent)
    delete (trimmed as ReachableRangeResponse & Record<string, unknown>).properties;
    return trimmed;
  }

  // Legacy REST format
  if (trimmed.reachableRange) {
    delete trimmed.reachableRange.boundary;
  }

  return trimmed;
}

/**
 * Build MCP response with trimmed data for agent and viz_id for Apps to fetch full data from cache.
 * Full data is stored in cache with short TTL for Apps to retrieve via tomtom-get-viz-data tool.
 */
export async function buildCompressedResponse<T>(
  trimmedData: T,
  fullData: T,
  showUI: boolean = true
): Promise<MCPResponse> {
  // If UI is disabled, don't cache the full data
  if (!showUI) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              ...trimmedData,
              _meta: { show_ui: false },
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Store full data in cache and get unique viz_id
  const vizId = await storeVizData(fullData);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            ...trimmedData,
            _meta: { show_ui: true, viz_id: vizId },
          },
          null,
          2
        ),
      },
    ],
  };
}
