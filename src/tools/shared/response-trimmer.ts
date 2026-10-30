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

import type { TextContent } from "@modelcontextprotocol/sdk/types.js";
import {
  type ConnectorCount,
  indexedMagnitudes,
  type OpeningHours,
  type TimeZone,
  type TrafficIncidentDetails,
} from "@tomtom-org/maps-sdk/core";
import { APP_DATA_META_KEY } from "../../constants";
import type { ResponseDetail } from "../../schemas/shared/responseOptions";
import { handleApiError, toErrorPayload } from "../../utils/apiErrorHandler";
import { logger } from "../../utils/logger";
import { isRecord } from "../../utils/record";
import { redactCredentials } from "../../utils/redact";
import { APP_DATA, encodeAppData, MAX_INLINE_RESULT_CHARS } from "./app-data";
import { featureCollection, type GeometryFeature, withGeometry } from "./geometry-response";
import { summarizeOpeningHours } from "./opening-hours";
import type { ResponseMeta, ToolResponse } from "./tool-entry";

// ============================================================================
// API Response Interfaces (flexible - allow additional properties from real API)
// ============================================================================

/** The incidents the SDK returns, with the summary the cap adds over all of them. */
export type TrafficResponse = TrafficIncidentDetails & { incidentSummary?: TrafficIncidentSummary };

/** One road's incidents, over every incident found, kept or not. */
export interface RoadIncidents {
  road: string;
  incidents: number;
  delayInSeconds: number;
}

export interface TrafficIncidentSummary {
  totalIncidents: number;
  returnedIncidents: number;
  truncated: boolean;
  totalDelayInSeconds: number;
  incidentsByCategory: Record<string, number>;
  incidentsByMagnitude: Record<string, number>;
  /** The roads with the most incidents, most first. */
  byRoad: RoadIncidents[];
  incidentsWithoutRoadNumber: number;
  note?: string;
}

/** How many roads `byRoad` lists. */
const MAX_SUMMARY_ROADS = 20;

/** Optional fields that compact drops unless the caller asked for them with the matching tool input. */
export interface RequestedFields {
  /** Per-incident timeValidity (timeValidityFilter other than "present"). */
  timeValidity?: boolean;
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
 *   - POI: localizedCategories (the category codes stay), timeZone, and the opening hours'
 *     time ranges, which become whether it is open now and today's hours
 *   - Charging: chargingPark.chargingStations, per charging point (the connectors summarize them)
 *   - Metadata: dataSources, matchConfidence, info, score, entryPoints
 *   - Address: countryCodeISO3, countrySubdivisionCode(Iso), countrySubdivisionName, localName,
 *     extendedPostalCode
 *   - Fields no tool asks for: mapcodes, relatedPois, addressRanges
 *
 * Keeps:
 *   - POI: name, phone, url, categories, brands, openingHours (summarised)
 *   - Address: freeformAddress, streetName, streetNumber, municipality, postalCode, countryCode, country, countrySubdivision
 *   - Core: type, distance, chargingPark (connectors flattened), geometry
 */
export function trimGeoJSONFeatureProperties(props: Record<string, unknown>): void {
  const poi = props.poi as Record<string, unknown> | undefined;
  if (poi) {
    delete poi.localizedCategories;
    if (poi.openingHours) {
      const timeZone = (poi.timeZone as TimeZone | undefined)?.ianaId;
      poi.openingHours = summarizeOpeningHours(poi.openingHours as OpeningHours, timeZone);
    }
    delete poi.timeZone;
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
  delete props.mapcodes;
  delete props.addressRanges;
  delete props.relatedPois;

  const address = props.address as Record<string, unknown> | undefined;
  if (address) trimAddress(address);
}

/** Redundant address fields. */
function trimAddress(address: Record<string, unknown>): void {
  delete address.countryCodeISO3;
  delete address.countrySubdivisionCode;
  delete address.countrySubdivisionCodeIso; // reverse geocode's countrySubdivisionCode
  delete address.countrySubdivisionName; // duplicate of countrySubdivision
  delete address.localName; // usually same as municipality
  delete address.extendedPostalCode;
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
export function trimSearchFeature(feature: Record<string, unknown>): void {
  delete feature.bbox;
  const props = feature.properties as Record<string, unknown> | undefined;
  if (props) trimGeoJSONFeatureProperties(props);
}

/** The SDK puts the API summary under the collection's properties. */
function trimFeatureCollectionMetadata(resp: Record<string, unknown>): void {
  const summary = resp.properties as Record<string, unknown> | undefined;
  if (summary) trimSearchSummary(summary);
}

/**
 * SDK route section types that are map-rendering data with no actionable
 * information for an agent once the coordinates are gone, or that the route
 * analysis summarises.
 */
const ROUTE_SECTIONS_TO_STRIP = [
  "roadShields",
  "speedLimit",
  "urban",
  "tunnel",
  "lowEmissionZone",
  "pedestrian",
  "vehicleRestricted",
  "country",
  "importantRoadStretch",
  "distinct",
  "curve",
  "curvyStretch",
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
 * `perRoute[i]` is merged into the properties of route `i`.
 */
export function trimRoutingResponse(response: unknown, perRoute: readonly object[] = []): unknown {
  if (!response) return response;
  const resp = response as Record<string, unknown>;

  if (Array.isArray(resp?.features)) {
    const trimmed = structuredClone(resp);
    (trimmed.features as Array<Record<string, unknown>>)?.forEach((feature, index) => {
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
        Object.assign(props, perRoute[index]);
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
export function trimSearchResponse(response: unknown): unknown {
  if (!response) return response;
  const resp = response as Record<string, unknown>;

  if (Array.isArray(resp?.features)) {
    const trimmed = structuredClone(resp);

    trimFeatureCollectionMetadata(trimmed);

    for (const feature of trimmed.features as Array<Record<string, unknown>>) {
      trimSearchFeature(feature);
    }

    return trimmed;
  }

  // SDK format: single GeoJSON Feature (reverse geocode)
  if (resp?.type === "Feature" && resp?.properties) {
    const trimmed = structuredClone(resp);
    trimSearchFeature(trimmed);
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

const countInto = (counts: Record<string, number>, key: string): void => {
  counts[key] = (counts[key] ?? 0) + 1;
};

/**
 * Cap the number of traffic incidents returned to the agent, and summarise all of them.
 *
 * Large bounding boxes can return thousands of incidents, overflowing client context limits.
 * Over the cap, the most severe incidents (by magnitudeOfDelay) are kept. The
 * `incidentSummary` counts every incident found, by category, magnitude and road,
 * so totals and per-road questions need neither every incident nor counting by the agent.
 */
export function capTrafficIncidents(
  response: TrafficIncidentDetails,
  maxIncidents: number = DEFAULT_MAX_TRAFFIC_INCIDENTS
): TrafficResponse {
  const total = response.features.length;
  const incidentsByCategory: Record<string, number> = {};
  const incidentsByMagnitude: Record<string, number> = {};
  const roads = new Map<string, RoadIncidents>();
  let totalDelayInSeconds = 0;
  let incidentsWithoutRoadNumber = 0;
  for (const { properties } of response.features) {
    countInto(incidentsByCategory, properties.category);
    countInto(incidentsByMagnitude, properties.magnitudeOfDelay);
    const delay = properties.delayInSeconds ?? 0;
    totalDelayInSeconds += delay;
    if (!properties.roadNumbers?.length) incidentsWithoutRoadNumber++;
    for (const road of new Set(properties.roadNumbers)) {
      const entry = roads.get(road) ?? { road, incidents: 0, delayInSeconds: 0 };
      entry.incidents++;
      entry.delayInSeconds += delay;
      roads.set(road, entry);
    }
  }
  const byRoad = [...roads.values()]
    .sort((a, b) => b.incidents - a.incidents || b.delayInSeconds - a.delayInSeconds)
    .slice(0, MAX_SUMMARY_ROADS);

  const truncated = total > maxIncidents;
  const kept = truncated
    ? [...response.features]
        .sort(
          (a, b) =>
            indexedMagnitudes.indexOf(b.properties.magnitudeOfDelay) -
            indexedMagnitudes.indexOf(a.properties.magnitudeOfDelay)
        )
        .slice(0, maxIncidents)
    : response.features;

  return {
    ...response,
    features: kept,
    incidentSummary: {
      totalIncidents: total,
      returnedIncidents: kept.length,
      truncated,
      totalDelayInSeconds,
      incidentsByCategory,
      incidentsByMagnitude,
      byRoad,
      incidentsWithoutRoadNumber,
      ...(truncated && {
        // Says which questions the kept rows CAN answer: a note reading only "this
        // is a sample" had agents decline to name even the single worst incident.
        note:
          `Showing the ${kept.length} most severe of ${total} incidents, ranked by delay magnitude. ` +
          "Ranking questions (the single worst, the top few) are answerable from this list; the " +
          "totals, per-category and per-road counts above cover all " +
          `${total}. Narrow the area or use categoryFilter for the rest.`,
      }),
    },
  };
}

/**
 * Build the MCP error response for a failed tool call, logging the formatted error.
 */
export function buildErrorResponse(error: unknown, context: string): ToolResponse {
  const formattedError = handleApiError(error, context);
  logger.error({ error: formattedError.message }, `${context} failed`);
  return errorResult(formattedError);
}

/** The MCP error response carrying the error's payload. */
export function errorResult(error: Error): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(toErrorPayload(error)) }],
    isError: true,
  };
}

/**
 * The payload with `show_ui` added, and the result `_meta` carrying that same `show_ui`.
 * `show_ui` stays on the text too, so a host that drops the result `_meta` can still hide the map.
 */
function withShowUI(data: unknown, showUI: boolean): { data: unknown; _meta: ResponseMeta } {
  const _meta: ResponseMeta = { show_ui: showUI };
  if (!isRecord(data)) return { data, _meta };
  return { data: { ...data, show_ui: showUI }, _meta };
}

/**
 * Build the MCP response for a successful tool call. With response_detail "full"
 * the agent gets `full` untrimmed; otherwise it gets `trim(full)` and the app
 * gets `appData`, the full result unless given. With "geometry", `trim(full)`
 * also carries the features `geometry(full)` builds.
 * `context` is added at every level, "full" included.
 */
export async function buildToolResponse<T>(
  full: T,
  trim: (full: T) => unknown,
  options: {
    showUI: boolean;
    responseDetail: ResponseDetail | undefined;
    /** What the app draws; null for an app that draws from its tool input alone. */
    appData?: unknown;
    geometry?: (full: T) => Array<GeometryFeature | null | undefined>;
    /** How the tool arrived at the result: where its inputs resolved, what it searched. */
    context?: Record<string, unknown>;
  }
): Promise<ToolResponse> {
  const { showUI, responseDetail, appData = full, geometry, context } = options;
  if (responseDetail === "full") {
    const { data, _meta } = withShowUI({ ...full, ...context }, showUI);
    return { content: [{ type: "text", text: JSON.stringify(data) }], _meta };
  }
  const trimmed = context ? { ...(trim(full) as object), ...context } : trim(full);
  if (responseDetail === "geometry" && geometry) {
    return buildCompressedResponse(
      withGeometry(trimmed, featureCollection(geometry(full))),
      appData,
      { showUI }
    );
  }
  return buildCompressedResponse(trimmed, appData, { showUI });
}

/**
 * Build the MCP response for a tool with an MCP App (CONTEXT.md, App data):
 * - `trimmedData` for the agent, as minified JSON text, since indentation costs tokens;
 * - one result `_meta`: `show_ui` and `appData` under `com.tomtom/app-data` when the
 *   whole result fits (route lines simplified to fit unless `exact`). A null `appData`
 *   gives the app nothing. The server also keeps the app data beside the result under APP_DATA.
 */
export async function buildCompressedResponse<T>(
  trimmedData: T,
  appData: unknown,
  { showUI = true, exact = false }: { showUI?: boolean; exact?: boolean } = {}
): Promise<ToolResponse> {
  const { data, _meta } = withShowUI(trimmedData, showUI);
  const content: TextContent[] = [{ type: "text", text: JSON.stringify(data) }];
  if (!showUI || appData === null) return { content, _meta };
  // The maps-sdk echoes its request, API key included, into the features it returns.
  if (!exact) redactCredentials(appData);

  // Measured as serialized, where the text's quotes are escaped; base64 needs no escapes.
  const envelope = JSON.stringify({
    content,
    _meta: { ..._meta, [APP_DATA_META_KEY]: "" },
  }).length;
  const { inline, report } = await encodeAppData(
    appData,
    MAX_INLINE_RESULT_CHARS - envelope,
    exact
  );
  return {
    content,
    _meta: { ..._meta, ...(inline !== undefined && { [APP_DATA_META_KEY]: inline }) },
    [APP_DATA]: { data: appData, report },
  };
}
