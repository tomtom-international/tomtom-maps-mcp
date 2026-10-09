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
 * Response trimming utilities for MCP tool responses.
 */

import type {
  ConnectorCount,
  DelayMagnitude,
  TrafficIncidentDetails,
} from "@tomtom-org/maps-sdk/core";
import type { ResponseDetail } from "../../schemas/shared/responseOptions";
import { storeVizData } from "../../services/cache/vizCache";
import { handleApiError, toErrorPayload } from "../../utils/apiErrorHandler";
import { logger } from "../../utils/logger";
import { featureCollection, withGeometry, type GeometryFeature } from "./geometryResponse";

// ============================================================================
// API Response Interfaces (flexible - allow additional properties from real API)
// ============================================================================

/** The incidents the SDK returns, with the summary the cap adds when it drops some. */
export type TrafficResponse = TrafficIncidentDetails & { incidentSummary?: TrafficIncidentSummary };

export interface TrafficIncidentSummary {
  totalIncidents: number;
  returnedIncidents: number;
  truncated: true;
  incidentsByCategory: Record<string, number>;
  note: string;
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

/**
 * Optional fields that compact drops unless the caller asked for them with the
 * matching tool parameter (openingHours, timeZone, mapcodes,
 * extendedPostalCodesFor, relatedPois, addressRanges, timeValidityFilter).
 */
export interface RequestedFields {
  openingHours?: boolean;
  timeZone?: boolean;
  mapcodes?: boolean;
  extendedPostalCode?: boolean;
  relatedPois?: boolean;
  addressRanges?: boolean;
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
export function requestedTrafficFields(timeValidityFilter?: string[]): RequestedFields {
  return { timeValidity: timeValidityFilter?.includes("future") ?? false };
}

// ============================================================================
// Shared GeoJSON Feature Trimming (SDK responses)
// ============================================================================

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
 * Trim verbose properties from an SDK place's properties object.
 * Field names follow the SDK's parsed shape, not the raw API: the SDK already
 * turns classifications into categories/localizedCategories, drops categorySet,
 * and moves viewport/boundingBox to feature.bbox (see trimSearchFeature).
 *
 * Removes:
 *   - POI: localizedCategories (the category codes stay)
 *   - Charging: chargingPark.chargingStations, per charging point (the connectors summarize them)
 *   - Metadata: dataSources, matchConfidence, info, score, entryPoints
 *   - Address: countryCodeISO3, countrySubdivisionCode(Iso), countrySubdivisionName, localName
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
  const poi = props.poi as Record<string, unknown> | undefined;
  if (poi) {
    delete poi.localizedCategories;
    if (!requested.timeZone) delete poi.timeZone;
    if (!requested.openingHours) delete poi.openingHours;
  }

  // The flattened entries replace the SDK's ConnectorCount objects in place.
  const chargingPark = props.chargingPark as Record<string, unknown> | undefined;
  if (chargingPark) {
    delete chargingPark.chargingStations;
    if (Array.isArray(chargingPark.connectors)) {
      chargingPark.connectors = flattenConnectors(chargingPark.connectors as ConnectorCount[]);
    }
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

  const address = props.address as Record<string, unknown> | undefined;
  if (address) trimAddress(address, requested);
}

/** Redundant address fields. */
function trimAddress(address: Record<string, unknown>, requested: RequestedFields): void {
  delete address.countryCodeISO3;
  delete address.countrySubdivisionCode;
  delete address.countrySubdivisionCodeIso; // reverse geocode's countrySubdivisionCode
  delete address.countrySubdivisionName; // duplicate of countrySubdivision
  delete address.localName; // usually same as municipality
  if (!requested.extendedPostalCode) delete address.extendedPostalCode;
}

/** Query timing and internal metadata in a search summary. Keeps result counts and nextCursor. */
function trimSearchSummary(summary: Record<string, unknown>): void {
  delete summary.queryTime;
  delete summary.fuzzyLevel;
  delete summary.geoBias;
}

/**
 * Trim an SDK place feature: its properties, plus feature.bbox, which is
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

/** The SDK puts the API summary under the collection's properties. */
function trimFeatureCollectionMetadata(resp: Record<string, unknown>): void {
  const summary = resp.properties as Record<string, unknown> | undefined;
  if (summary) trimSearchSummary(summary);
}

/**
 * SDK route section types that are map-rendering data with no actionable
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
 * Trim SDK route sections ({ leg: [...], traffic: [...], ... }) in place:
 *   - drops the map-rendering section types (ROUTE_SECTIONS_TO_STRIP);
 *   - removes point references (id, startPointIndex, endPointIndex) from every entry;
 *   - removes `tec` from traffic sections, which repeats `categories` as codes.
 * Entries left empty (e.g. motorway, which only has point references) are dropped,
 * then section types left without entries.
 */
function trimRouteSections(sections: Record<string, unknown>): void {
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
 * SDK format (GeoJSON FeatureCollection):
 *   - features[].geometry.coordinates (full route polyline)
 *   - features[].bbox, properties.guidance, properties.progress
 *   - properties.sections: see trimRouteSections
 */
export function trimRoutingResponse(response: unknown): unknown {
  if (!response) return response;
  const resp = response as Record<string, unknown>;

  if (Array.isArray(resp?.features)) {
    const trimmed = structuredClone(resp);
    (trimmed.features as Array<Record<string, unknown>>)?.forEach((feature) => {
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
        const sections = props.sections as Record<string, unknown> | undefined;
        if (sections && typeof sections === "object") {
          trimRouteSections(sections);
        }
      }
    });
    return trimmed;
  }

  return response;
}

/**
 * Trim search response - removes verbose POI details and metadata.
 *
 * SDK format (GeoJSON FeatureCollection or single Feature):
 *   - properties.queryTime, fuzzyLevel, geoBias, nextCursor (collection summary)
 *   - features[]: see trimSearchFeature
 */
export function trimSearchResponse(response: unknown, requested: RequestedFields = {}): unknown {
  if (!response) return response;
  const resp = response as Record<string, unknown>;

  if (Array.isArray(resp?.features)) {
    const trimmed = structuredClone(resp);

    trimFeatureCollectionMetadata(trimmed);

    for (const feature of trimmed.features as Array<Record<string, unknown>>) {
      trimSearchFeature(feature, requested);
    }

    return trimmed;
  }

  // SDK format: single GeoJSON Feature (reverse geocode)
  if (resp?.type === "Feature" && resp?.properties) {
    const trimmed = structuredClone(resp);
    trimSearchFeature(trimmed, requested);
    return trimmed;
  }

  return response;
}

/**
 * Trim the traffic response to one flat object per incident.
 *
 * Drops the GeoJSON envelope (coordinates are for the map, which gets the full result),
 * the long internal `id`, `numberOfReports`, `lastReportTime` and
 * `probabilityOfOccurrence`, and repeats each event description once.
 * `timeValidity` is kept only when requested, i.e. the filter also asks for future incidents.
 */
export function trimTrafficResponse(
  response: TrafficResponse,
  requested: RequestedFields = {}
): { incidents: Array<Record<string, unknown>>; incidentSummary?: TrafficIncidentSummary } {
  const incidents = response.features.map(({ properties: p }) => {
    const out: Record<string, unknown> = {
      category: p.category,
      magnitudeOfDelay: p.magnitudeOfDelay,
    };
    if (p.from) out.from = p.from;
    if (p.to) out.to = p.to;
    if (p.lengthInMeters !== undefined) out.lengthInMeters = Math.round(p.lengthInMeters);
    if (p.delayInSeconds !== undefined) out.delayInSeconds = p.delayInSeconds;
    if (p.roadNumbers?.length) out.roadNumbers = p.roadNumbers;
    if (p.startTime) out.startTime = p.startTime;
    if (p.endTime) out.endTime = p.endTime;
    if (requested.timeValidity) out.timeValidity = p.timeValidity;
    const events = [...new Set(p.events.map((e) => e.description).filter(Boolean))];
    if (events.length) out.events = events;
    return out;
  });

  return response.incidentSummary
    ? { incidents, incidentSummary: response.incidentSummary }
    : { incidents };
}

/** Default maximum incidents returned to the agent (large bboxes can return thousands). */
export const DEFAULT_MAX_TRAFFIC_INCIDENTS = 100;

/** Delay magnitudes from least to most severe; indefinite is a closure. */
const SEVERITY: Record<DelayMagnitude, number> = {
  unknown: 0,
  minor: 1,
  moderate: 2,
  major: 3,
  indefinite: 4,
};

/**
 * Cap the number of traffic incidents returned to the agent.
 *
 * Large bounding boxes can return thousands of incidents, overflowing client context limits.
 * Over the cap, the most severe incidents (by magnitudeOfDelay) are kept and an
 * `incidentSummary` records the full totals so the agent knows the response was truncated.
 */
export function capTrafficIncidents(
  response: TrafficIncidentDetails,
  maxIncidents: number = DEFAULT_MAX_TRAFFIC_INCIDENTS
): TrafficResponse {
  const total = response.features.length;
  if (total <= maxIncidents) return response;

  const incidentsByCategory: Record<string, number> = {};
  for (const { properties } of response.features) {
    incidentsByCategory[properties.category] = (incidentsByCategory[properties.category] ?? 0) + 1;
  }

  const kept = [...response.features]
    .sort(
      (a, b) => SEVERITY[b.properties.magnitudeOfDelay] - SEVERITY[a.properties.magnitudeOfDelay]
    )
    .slice(0, maxIncidents);

  return {
    ...response,
    features: kept,
    incidentSummary: {
      totalIncidents: total,
      returnedIncidents: kept.length,
      truncated: true,
      incidentsByCategory,
      note:
        `Showing the ${kept.length} most severe of ${total} incidents. ` +
        `Narrow the bbox, use categoryFilter, or raise maxResults for more.`,
    },
  };
}

/**
 * Build the MCP error response for a failed tool call, logging the formatted error.
 */
export function buildErrorResponse(error: unknown, context: string): MCPResponse {
  const formattedError = handleApiError(error, context);
  logger.error({ error: formattedError.message }, `${context} failed`);
  return {
    content: [{ type: "text", text: JSON.stringify(toErrorPayload(formattedError)) }],
    isError: true,
  };
}

/**
 * Build the MCP response for a successful tool call. With response_detail "full"
 * the agent gets `full` untrimmed; otherwise it gets `trim(full)` and the app
 * fetches `cached` (the full result unless given) through the viz_id. With
 * "geometry", `trim(full)` also carries the features `geometry(full)` builds.
 */
export async function buildToolResponse<T>(
  full: T,
  trim: (full: T) => unknown,
  options: {
    showUI: boolean;
    responseDetail: ResponseDetail | undefined;
    cached?: unknown;
    geometry?: (full: T) => Array<GeometryFeature | null | undefined>;
  }
): Promise<MCPResponse> {
  const { showUI, responseDetail, cached = full, geometry } = options;
  if (responseDetail === "full") {
    return {
      content: [{ type: "text", text: JSON.stringify({ ...full, _meta: { show_ui: showUI } }) }],
    };
  }
  const trimmed = trim(full);
  if (responseDetail === "geometry" && geometry) {
    return buildCompressedResponse(
      withGeometry(trimmed, featureCollection(geometry(full))),
      cached,
      showUI
    );
  }
  return buildCompressedResponse(trimmed, cached, showUI);
}

/**
 * Build MCP response with trimmed data for agent and viz_id for Apps to fetch full data from cache.
 * Full data is stored in cache with short TTL for Apps to retrieve via tomtom-get-viz-data tool.
 * The text is minified JSON: indentation costs tokens without carrying information.
 */
export async function buildCompressedResponse<T>(
  trimmedData: T,
  fullData: unknown,
  showUI: boolean = true
): Promise<MCPResponse> {
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
