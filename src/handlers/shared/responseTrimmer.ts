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
    sections?: Array<{
      startPointIndex?: number;
      endPointIndex?: number;
      [key: string]: unknown;
    }>;
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
      brands?: unknown;
      features?: unknown; // Orbis only
      [key: string]: unknown;
    };
    address?: {
      countryCodeISO3?: string;
      countrySubdivisionCode?: string;
      countrySubdivisionName?: string;
      localName?: string;
      extendedPostalCode?: string;
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

/**
 * Optional fields that compact drops unless the caller asked for them with the
 * matching tool parameter (openingHours, timeZone, mapcodes,
 * extendedPostalCodesFor, relatedPois, addressRanges, instructionsType,
 * timeValidityFilter).
 */
export interface RequestedFields {
  openingHours?: boolean;
  timeZone?: boolean;
  mapcodes?: boolean;
  extendedPostalCode?: boolean;
  relatedPois?: boolean;
  addressRanges?: boolean;
  /** Routing: turn-by-turn guidance (instructionsType set). */
  guidance?: boolean;
  /** Traffic: per-incident timeValidity (timeValidityFilter other than "present"). */
  timeValidity?: boolean;
}

const isSet = (value: unknown) => (Array.isArray(value) ? value.length > 0 : Boolean(value));

/** Which optional search fields a tool call asked for, from its parameters. */
export function requestedSearchFields(params: {
  openingHours?: unknown;
  timeZone?: unknown;
  mapcodes?: unknown;
  extendedPostalCodesFor?: unknown;
  relatedPois?: unknown;
  addressRanges?: unknown;
}): RequestedFields {
  return {
    openingHours: isSet(params.openingHours),
    timeZone: isSet(params.timeZone),
    mapcodes: isSet(params.mapcodes),
    extendedPostalCode: isSet(params.extendedPostalCodesFor),
    relatedPois: isSet(params.relatedPois) && params.relatedPois !== "off",
    addressRanges: isSet(params.addressRanges),
  };
}

/** Traffic: keep timeValidity when the filter asks for more than present incidents. */
export function requestedTrafficFields(timeValidityFilter?: string): RequestedFields {
  return { timeValidity: Boolean(timeValidityFilter) && timeValidityFilter !== "present" };
}

// ============================================================================
// Shared GeoJSON Feature Trimming (Orbis SDK responses)
// ============================================================================

/** SDK connector entry: identical connectors grouped as { connector, count }. */
interface ConnectorCount {
  connector?: {
    type?: string;
    ratedPowerKW?: number;
    currentType?: string;
    chargingSpeed?: string;
  };
  count?: number;
}

/**
 * Flatten the SDK's grouped connectors to the fields an agent reasons about.
 * Drops voltage and current, which follow from the rated power.
 */
export function flattenConnectors(connectors: ConnectorCount[]): Array<Record<string, unknown>> {
  return connectors.map((c) => ({
    type: c.connector?.type,
    ratedPowerKW: c.connector?.ratedPowerKW,
    currentType: c.connector?.currentType,
    chargingSpeed: c.connector?.chargingSpeed,
    count: c.count,
  }));
}

/**
 * Trim verbose properties from an Orbis SDK place's properties object.
 * Field names follow the SDK's parsed shape, not the raw API: the SDK already
 * turns classifications into categories/localizedCategories, drops categorySet,
 * and moves viewport/boundingBox to feature.bbox (see trimSearchFeature).
 *
 * Removes:
 *   - POI: localizedCategories (the category codes stay)
 *   - Metadata: dataSources, matchConfidence, info, score, entryPoints
 *   - Address: countryCodeISO3, countrySubdivisionCode, countrySubdivisionName, localName
 *   - Unless requested: poi.openingHours, poi.timeZone, mapcodes, address.extendedPostalCode,
 *     relatedPois, addressRanges
 *
 * Keeps:
 *   - POI: name, phone, url, categories, brands
 *   - Address: freeformAddress, streetName, streetNumber, municipality, postalCode, countryCode, country, countrySubdivision
 *   - Core: type, distance, chargingPark (connectors flattened), geometry
 */
export function trimGeoJSONFeatureProperties(
  props: Record<string, unknown>,
  requested: RequestedFields = {}
): void {
  // Trim POI verbose fields
  const poi = props.poi as Record<string, unknown> | undefined;
  if (poi) {
    delete poi.localizedCategories;
    if (!requested.timeZone) delete poi.timeZone;
    if (!requested.openingHours) delete poi.openingHours;
  }

  const chargingPark = props.chargingPark as { connectors?: ConnectorCount[] } | undefined;
  if (Array.isArray(chargingPark?.connectors)) {
    chargingPark.connectors = flattenConnectors(chargingPark.connectors);
  }

  // Remove metadata fields (not useful for agent reasoning)
  delete props.dataSources;
  delete props.matchConfidence;
  delete props.info;
  delete props.score;
  delete props.entryPoints;
  if (!requested.mapcodes) delete props.mapcodes;
  if (!requested.addressRanges) delete props.addressRanges;
  if (!requested.relatedPois) delete props.relatedPois;

  // Trim redundant address fields
  const address = props.address as Record<string, unknown> | undefined;
  if (address) {
    delete address.countryCodeISO3;
    delete address.countrySubdivisionCode;
    delete address.countrySubdivisionName;
    delete address.localName;
    if (!requested.extendedPostalCode) delete address.extendedPostalCode;
  }
}

/**
 * Trim an Orbis SDK place feature: its properties, plus feature.bbox, which is
 * the SDK's home for the API's viewport/boundingBox (map display bounds).
 */
export function trimSearchFeature(
  feature: Record<string, unknown>,
  requested: RequestedFields = {}
): void {
  delete feature.bbox;
  const props = feature.properties as Record<string, unknown> | undefined;
  if (props) trimGeoJSONFeatureProperties(props, requested);
}

/**
 * Trim FeatureCollection-level metadata (Orbis SDK search responses).
 * The SDK puts the API summary under the collection's properties.
 * Removes the same fields as the TomTom Maps summary trim: query timing and
 * internal metadata. Keeps result counts.
 */
function trimFeatureCollectionMetadata(resp: Record<string, unknown>): void {
  const summary = resp.properties as Record<string, unknown> | undefined;
  if (!summary) return;
  delete summary.queryTime;
  delete summary.fuzzyLevel;
  delete summary.offset;
  delete summary.geoBias;
}

/**
 * Orbis SDK route section types that are map-rendering data with no actionable
 * information for an agent once the coordinates are gone.
 */
const ROUTE_SECTIONS_TO_STRIP = [
  "roadShields",
  "speedLimit",
  "urban",
  "tunnel",
  "lowEmissionZone",
  "pedestrian",
  "vehicleRestricted",
];

/** Route section entries point into the route's coordinates, which compact removes. */
const SECTION_POINT_REFS = ["id", "startPointIndex", "endPointIndex"];

/**
 * Trim Orbis SDK route sections ({ leg: [...], traffic: [...], ... }) in place:
 *   - drops the map-rendering section types (ROUTE_SECTIONS_TO_STRIP);
 *   - removes point references (id, startPointIndex, endPointIndex) from every entry;
 *   - removes `tec` from traffic sections, which repeats `categories` as codes.
 * Entries left empty (e.g. motorway, which only has point references) are dropped,
 * then section types left without entries.
 */
export function trimRouteSections(sections: Record<string, unknown>): void {
  for (const key of ROUTE_SECTIONS_TO_STRIP) {
    delete sections[key];
  }
  for (const [key, value] of Object.entries(sections)) {
    if (!Array.isArray(value)) continue;
    const kept = (value as Array<Record<string, unknown>>).filter((section) => {
      for (const ref of SECTION_POINT_REFS) delete section[ref];
      if (key === "traffic") delete section.tec;
      return Object.keys(section).length > 0;
    });
    if (kept.length) sections[key] = kept;
    else delete sections[key];
  }
}

/**
 * Trim routing response - removes large coordinate arrays and guidance instructions.
 *
 * COMMON (both backends):
 *   - routes[].legs[].points (50K-75K chars - polyline data for visualization)
 *   - routes[].guidance (turn-by-turn instructions), unless requested.guidance
 *
 * GENESIS ONLY:
 *   - routes[].sections[].startPointIndex/endPointIndex (point indexes into the removed legs[].points);
 *     sectionType, travelMode etc. are kept as they're small and useful
 *
 * ORBIS SDK FORMAT (GeoJSON FeatureCollection):
 *   - features[].geometry.coordinates (full route polyline)
 *   - features[].bbox, properties.guidance, properties.progress
 *   - properties.sections: see trimRouteSections
 */
export function trimRoutingResponse(
  response: unknown,
  _backend?: Backend,
  requested: RequestedFields = {}
): unknown {
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
        if (!requested.guidance) delete props.guidance;
        delete props.progress;
        const sections = props.sections as Record<string, unknown> | undefined;
        if (sections && typeof sections === "object") {
          trimRouteSections(sections);
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

    // COMMON: Remove turn-by-turn guidance (can be very large), unless the
    // caller asked for it with instructionsType
    if (!requested.guidance) delete route.guidance;

    // Sections are kept (small, useful for travelMode info), minus their indexes
    // into the points removed above.
    route.sections?.forEach((section) => {
      delete section.startPointIndex;
      delete section.endPointIndex;
    });
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
 *   - results[].poi.categorySet (redundant with categories)
 *   - results[].address.countryCodeISO3 (redundant with countryCode)
 *   - results[].address.countrySubdivisionCode (redundant)
 *   - results[].address.localName (usually same as municipality)
 *   - results[].score, results[].entryPoints (as on Orbis)
 *   - unless requested: poi.openingHours, poi.timeZone, addresses[].mapcodes,
 *     address.extendedPostalCode (already part of freeformAddress),
 *     results[].relatedPois, results[].addressRanges
 *
 * ORBIS SDK FORMAT (GeoJSON FeatureCollection or single Feature):
 *   - properties.queryTime, fuzzyLevel, offset, geoBias (collection summary)
 *   - features[]: see trimSearchFeature
 */
export function trimSearchResponse(
  response: unknown,
  backend?: Backend,
  requested: RequestedFields = {}
): unknown {
  if (!response) return response;
  const resp = response as Record<string, unknown>;

  // SDK format: GeoJSON FeatureCollection with features[] (orbis backend)
  if (Array.isArray(resp?.features)) {
    const trimmed = deepClone(resp);

    // Trim FeatureCollection-level metadata
    trimFeatureCollectionMetadata(trimmed);

    // Trim each feature (bbox and properties)
    for (const feature of trimmed.features as Array<Record<string, unknown>>) {
      trimSearchFeature(feature, requested);
    }

    return trimmed;
  }

  // SDK format: single GeoJSON Feature (reverse geocode)
  if (resp?.type === "Feature" && resp?.properties) {
    const trimmed = deepClone(resp);
    trimSearchFeature(trimmed, requested);
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
  for (const result of trimmed.results ?? []) {
    trimLegacyResult(result, backend, requested);
  }

  // Trim addresses array (reverse geocoding)
  trimmed.addresses?.forEach((addr) => {
    if (!requested.mapcodes) delete addr.mapcodes;
    delete addr.matchType;

    // Remove redundant address fields
    if (addr.address) {
      trimLegacyAddress(addr.address, requested);
      delete addr.address.boundingBox;
    }
  });

  return trimmed;
}

/** Trim one TomTom Maps (REST) search result in place. */
function trimLegacyResult(
  result: NonNullable<SearchResponse["results"]>[number],
  backend: Backend | undefined,
  requested: RequestedFields
): void {
  // COMMON: Remove verbose POI fields
  if (result.poi) {
    delete result.poi.classifications;
    delete result.poi.categorySet;
    if (!requested.openingHours) delete result.poi.openingHours;
    if (!requested.timeZone) delete result.poi.timeZone;

    // ORBIS ONLY: Remove features (only exists in Orbis)
    if (backend !== "genesis") {
      delete result.poi.features;
    }
  }

  // COMMON: Remove metadata fields
  delete result.dataSources;
  delete result.matchConfidence;
  delete result.info;
  delete result.viewport;
  delete result.boundingBox;
  // Parity with Orbis: ranking score and navigation entry points
  delete result.score;
  delete result.entryPoints;
  if (!requested.relatedPois) delete result.relatedPois;
  if (!requested.addressRanges) delete result.addressRanges;

  // COMMON: Remove redundant address fields
  if (result.address) {
    trimLegacyAddress(result.address, requested);
  }
}

/** Redundant address fields in TomTom Maps (REST) search and reverse geocode results. */
function trimLegacyAddress(address: Record<string, unknown>, requested: RequestedFields): void {
  delete address.countryCodeISO3;
  delete address.countrySubdivisionCode;
  delete address.countrySubdivisionName; // duplicate of countrySubdivision
  delete address.localName; // usually same as municipality
  if (!requested.extendedPostalCode) delete address.extendedPostalCode;
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
 *   - incidents[].properties.timeValidity ("present" with the default filter; kept when
 *     requested.timeValidity, i.e. the filter also asks for future incidents)
 */
export function trimTrafficResponse(
  response: unknown,
  _backend?: Backend,
  requested: RequestedFields = {}
): unknown {
  const resp = response as TrafficResponse;
  if (!resp?.incidents) return response;

  // Rebuild each incident keeping only agent-relevant fields. Dropping the
  // GeoJSON envelope (type/geometry — coordinates are visualization-only and
  // already useless without them), the long internal `id`, and null/empty
  // fields cuts the agent payload ~4x on dense bboxes. The full untrimmed
  // result is still cached for the map UI, so nothing visual is lost.
  const incidents = resp.incidents.map((incident) => {
    const p = (incident.properties ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};

    if (p.iconCategory !== undefined) out.iconCategory = p.iconCategory;
    if (p.magnitudeOfDelay !== undefined) out.magnitudeOfDelay = p.magnitudeOfDelay;
    if (p.from) out.from = p.from;
    if (p.to) out.to = p.to;
    if (typeof p.length === "number") out.length = Math.round(p.length);
    if (p.delay != null) out.delay = p.delay;
    if (Array.isArray(p.roadNumbers) && p.roadNumbers.length) out.roadNumbers = p.roadNumbers;
    if (p.startTime) out.startTime = p.startTime;
    if (p.endTime) out.endTime = p.endTime;
    if (requested.timeValidity && p.timeValidity) out.timeValidity = p.timeValidity;

    // Flatten events ({code, description, iconCategory}) to unique descriptions —
    // code/iconCategory duplicate fields already on the incident.
    if (Array.isArray(p.events) && p.events.length) {
      const descriptions = [
        ...new Set(
          (p.events as Array<{ description?: string }>).map((e) => e?.description).filter(Boolean)
        ),
      ];
      if (descriptions.length) out.events = descriptions;
    }

    return out;
  });

  // Preserve sibling top-level fields (e.g. incidentSummary added by the cap).
  return { ...resp, incidents };
}

/** Default maximum incidents returned to the agent (large bboxes can return thousands). */
export const DEFAULT_MAX_TRAFFIC_INCIDENTS = 100;

/**
 * Cap the number of traffic incidents returned to the agent.
 *
 * Large bounding boxes can return thousands of incidents (hundreds of KB even
 * after field trimming), overflowing client context limits. When the response
 * exceeds the cap, the most severe incidents (by magnitudeOfDelay) are kept and
 * an `incidentSummary` records the full totals so the agent knows the response
 * was truncated.
 */
export function capTrafficIncidents(
  response: unknown,
  maxIncidents: number = DEFAULT_MAX_TRAFFIC_INCIDENTS
): unknown {
  const resp = response as TrafficResponse;
  if (!resp?.incidents || resp.incidents.length <= maxIncidents) {
    return response;
  }

  const total = resp.incidents.length;
  const byCategory: Record<string, number> = {};
  for (const incident of resp.incidents) {
    const category = incident.properties?.iconCategory;
    const key = category === undefined || category === null ? "unknown" : String(category);
    byCategory[key] = (byCategory[key] ?? 0) + 1;
  }

  const kept = [...resp.incidents]
    .sort(
      (a, b) =>
        (Number(b.properties?.magnitudeOfDelay) || 0) -
        (Number(a.properties?.magnitudeOfDelay) || 0)
    )
    .slice(0, maxIncidents);

  return {
    ...resp,
    incidents: kept,
    incidentSummary: {
      totalIncidents: total,
      returnedIncidents: kept.length,
      truncated: true,
      incidentsByIconCategory: byCategory,
      note:
        `Showing the ${kept.length} most severe of ${total} incidents. ` +
        `Narrow the bbox, use categoryFilter, or raise maxResults for more.`,
    },
  };
}

/**
 * Trim reachable range response - removes boundary coordinates.
 *
 * SDK format (GeoJSON FeatureCollection from calculateReachableRanges):
 *   - features[].geometry.coordinates (large polygon boundary arrays)
 *   - features[].properties, except budget and origin (see rangeProperties)
 *   - bbox (overall bounds, the same as the largest ring's bbox)
 *
 * SDK format (single GeoJSON PolygonFeature):
 *   - geometry.coordinates (large polygon boundary array)
 *   - properties, except budget and origin
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
      feature.properties = rangeProperties(feature.properties);
    });
    delete fc.bbox;
    return trimmed;
  }

  // SDK format: single GeoJSON PolygonFeature
  if (trimmed.type === "Feature" && trimmed.geometry) {
    // Remove large polygon coordinates (only needed for visualization)
    delete trimmed.geometry.coordinates;
    // Keep only which budget this range is for
    trimmed.properties = rangeProperties(trimmed.properties);
    return trimmed;
  }

  // Legacy REST format
  if (trimmed.reachableRange) {
    delete trimmed.reachableRange.boundary;
  }

  return trimmed;
}

/**
 * The SDK sets a range's properties to its request params, apiKey included (#283).
 * Keep only budget and origin, which say which ring is which (e.g. 30 minutes),
 * by picking them rather than deleting the rest.
 */
function rangeProperties(properties: unknown): Record<string, unknown> {
  const p = (properties ?? {}) as Record<string, unknown>;
  return {
    ...(p.budget !== undefined ? { budget: p.budget } : {}),
    ...(p.origin !== undefined ? { origin: p.origin } : {}),
  };
}

/**
 * Build MCP response with trimmed data for agent and viz_id for Apps to fetch full data from cache.
 * Full data is stored in cache with short TTL for Apps to retrieve via tomtom-get-viz-data tool.
 * The text is minified JSON: indentation costs tokens without carrying information.
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
          text: JSON.stringify({ ...trimmedData, _meta: { show_ui: false } }),
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
        text: JSON.stringify({ ...trimmedData, _meta: { show_ui: true, viz_id: vizId } }),
      },
    ],
  };
}
