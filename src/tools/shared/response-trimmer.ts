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
 */

import type {
  ChargingStationsAvailability,
  ChargingStopProps,
  ConnectorCount,
  Places,
  Routes,
} from "@tomtom-org/maps-sdk/core";
import type { ResponseDetail } from "../../schemas/shared/responseOptions";
import {
  type DatasetProvenance,
  datasetMeta,
  storeDataset,
} from "../../services/datasets/dataset-store";
import { handleApiError, toErrorPayload } from "../../utils/apiErrorHandler";
import { logger } from "../../utils/logger";
import { featureCollection, type GeometryFeature, withGeometry } from "./geometry-response";
import type { ToolDataKind } from "./tool-entry";

// ============================================================================
// API Response Interfaces (flexible - allow additional properties from real API)
// ============================================================================

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
export function requestedTrafficFields(timeValidityFilter?: string): RequestedFields {
  return { timeValidity: Boolean(timeValidityFilter) && timeValidityFilter !== "present" };
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

  // The flattened entries replace the SDK's ConnectorCount objects in place.
  const chargingPark = props.chargingPark as Record<string, unknown> | undefined;
  if (Array.isArray(chargingPark?.connectors)) {
    chargingPark.connectors = flattenConnectors(chargingPark.connectors as ConnectorCount[]);
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
  delete address.countrySubdivisionName; // duplicate of countrySubdivision
  delete address.localName; // usually same as municipality
  if (!requested.extendedPostalCode) delete address.extendedPostalCode;
}

/** Query timing and internal metadata in a search summary. Keeps result counts. */
function trimSearchSummary(summary: Record<string, unknown>): void {
  delete summary.queryTime;
  delete summary.fuzzyLevel;
  delete summary.offset;
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
 * SDK format (GeoJSON FeatureCollection):
 *   - features[].geometry.coordinates (full route polyline)
 *   - features[].bbox, properties.guidance, properties.progress
 *   - properties.sections: see trimRouteSections
 */
export function trimRoutingResponse(response: unknown): unknown {
  if (!response) return response;
  const resp = response as Record<string, unknown>;

  // SDK format: GeoJSON FeatureCollection with features[]
  if (Array.isArray(resp?.features)) {
    const trimmed = structuredClone(resp);
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
 *   - properties.queryTime, fuzzyLevel, offset, geoBias (collection summary)
 *   - features[]: see trimSearchFeature
 */
export function trimSearchResponse(response: unknown, requested: RequestedFields = {}): unknown {
  if (!response) return response;
  const resp = response as Record<string, unknown>;

  // SDK format: GeoJSON FeatureCollection with features[]
  if (Array.isArray(resp?.features)) {
    const trimmed = structuredClone(resp);

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
    const trimmed = structuredClone(resp);
    trimSearchFeature(trimmed, requested);
    return trimmed;
  }

  return response;
}

/**
 * Trim traffic response - removes geometry coordinates and verbose metadata.
 *
 * Removes:
 *   - incidents[].geometry.coordinates (large polyline arrays - 500-1000 chars each)
 *   - incidents[].properties.tmc (traffic message channel codes)
 *   - incidents[].properties.aci (internal codes)
 *   - incidents[].properties.numberOfReports (null in most cases)
 *   - incidents[].properties.lastReportTime (null in most cases)
 *   - incidents[].properties.probabilityOfOccurrence (always "certain")
 *   - incidents[].properties.timeValidity ("present" with the default filter; kept when
 *     requested.timeValidity, i.e. the filter also asks for future incidents)
 */
export function trimTrafficResponse(response: unknown, requested: RequestedFields = {}): unknown {
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
  maxIncidents: number = DEFAULT_MAX_TRAFFIC_INCIDENTS,
  remedy = "Narrow the area, use categoryFilter, or raise maxResults for more."
): TrafficResponse {
  const resp = response as TrafficResponse;
  if (!resp?.incidents || resp.incidents.length <= maxIncidents) {
    return resp;
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
      // Says which questions the kept rows CAN answer: a note reading only "this
      // is a sample" had agents decline to name even the single worst incident.
      note:
        `Showing the ${kept.length} most severe of ${total} incidents, ranked by delay magnitude. ` +
        "Ranking questions (the single worst, the top few) are answerable from this list, and " +
        `the totals are above; per-road breakdowns are not. ${remedy}`,
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
 */
export function trimReachableRangeResponse(response: unknown): unknown {
  const resp = response as Record<string, unknown> | undefined;
  if (resp?.type !== "FeatureCollection" || !Array.isArray(resp.features)) return response;

  const trimmed = structuredClone(resp);
  (trimmed.features as Array<Record<string, unknown>>).forEach((feature) => {
    const geom = feature.geometry as Record<string, unknown> | undefined;
    if (geom) delete geom.coordinates;
    feature.properties = rangeProperties(feature.properties);
  });
  delete trimmed.bbox;
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

/** What a stored dataset records about where it came from. */
export interface DatasetAttribution {
  kind?: ToolDataKind;
  provenance: DatasetProvenance;
}

/**
 * Build the MCP response for a successful tool call. With response_detail "full"
 * the agent gets `full` untrimmed; otherwise it gets `trim(full)` and the app
 * redeems `cached` (the full result unless given) through the dataset_id. With
 * "geometry", `trim(full)` also carries the features `geometry(full)` builds.
 * `context` is added at every level, "full" included.
 */
export async function buildToolResponse<T>(
  full: T,
  trim: (full: T) => unknown,
  options: {
    showUI: boolean;
    responseDetail: ResponseDetail | undefined;
    cached?: unknown;
    geometry?: (full: T) => Array<GeometryFeature | null | undefined>;
    dataset?: DatasetAttribution;
    /** How the tool arrived at the result: where its inputs resolved, what it searched. */
    context?: Record<string, unknown>;
  }
): Promise<MCPResponse> {
  const { showUI, responseDetail, cached = full, geometry, dataset, context } = options;
  if (responseDetail === "full") {
    return {
      content: [
        { type: "text", text: JSON.stringify({ ...full, ...context, _meta: { show_ui: showUI } }) },
      ],
    };
  }
  const trimmed = context ? { ...(trim(full) as object), ...context } : trim(full);
  if (responseDetail === "geometry" && geometry) {
    return buildCompressedResponse(
      withGeometry(trimmed, featureCollection(geometry(full))),
      cached,
      showUI,
      dataset
    );
  }
  return buildCompressedResponse(trimmed, cached, showUI, dataset);
}

/**
 * Build the MCP response: the trimmed projection for the model, plus a
 * `dataset_id` naming the full response held server-side. The app redeems it
 * through the app-only `tomtom-get-dataset`; the model passes it to
 * `tomtom-describe-dataset` and `tomtom-analyse-data`. Stored whether or not
 * `show_ui` is set, so the handle is valid for every consumer.
 * The text is minified JSON: indentation costs tokens without carrying information.
 */
export async function buildCompressedResponse<T>(
  trimmedData: T,
  fullData: unknown,
  showUI: boolean = true,
  dataset?: DatasetAttribution
): Promise<MCPResponse> {
  // Without an attribution there is nothing to store the data under.
  const meta = dataset
    ? datasetMeta(storeDataset({ data: fullData, ...dataset }), showUI)
    : { show_ui: showUI };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ ...trimmedData, _meta: meta }),
      },
    ],
  };
}

// ============================================================================
// Per-tool projections
// ============================================================================

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

/** EV stations: the shared search trim, plus each station's availability summary. */
export function trimEVSearchResponse(response: Places): Places {
  if (!response?.features) return response;

  // Shared search trim (collection summary and features), which also flattens
  // chargingPark.connectors
  const trimmed = trimSearchResponse(response) as Places;

  for (const feature of trimmed.features) {
    const chargingPark = feature.properties?.chargingPark as EVChargingPark | undefined;
    if (chargingPark) trimEVAvailability(chargingPark);
  }

  return trimmed;
}

interface ChargingInfo {
  geometry?: unknown;
  properties?: Partial<ChargingStopProps>;
  [key: string]: unknown;
}

interface LegItem {
  summary?: {
    chargingInformationAtEndOfLeg?: ChargingInfo;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Long-distance EV routing: the routing trim, plus a reduced charging-stop
 * record per leg.
 */
export function trimEVRoutingResponse(response: Routes): Routes {
  if (!response?.features) return response;

  const trimmed = structuredClone(response);

  trimmed.features = trimmed.features.map((feature) => {
    const geom = feature.geometry as { coordinates?: unknown[]; type?: string } | undefined;
    if (geom?.coordinates) {
      const coords = geom.coordinates;
      if (Array.isArray(coords) && coords.length > 2) {
        geom.coordinates = [coords[0], coords[coords.length - 1]];
      }
    }

    // Map display bounds, as in routing
    delete (feature as { bbox?: unknown }).bbox;

    const props = (feature.properties ?? {}) as Record<string, unknown>;

    const sections = props.sections as Record<string, unknown> | undefined;
    if (sections) {
      // Same section trim as routing: drops the map-rendering types and each
      // section's id and point indexes (the coordinates are trimmed above)
      trimRouteSections(sections);
      if (Array.isArray(sections.leg)) {
        sections.leg = (sections.leg as LegItem[]).map((legItem: LegItem) => {
          const ci = legItem.summary?.chargingInformationAtEndOfLeg;
          if (ci && legItem.summary) {
            legItem.summary.chargingInformationAtEndOfLeg = trimChargingInfo(ci);
          }
          return legItem;
        });
      }
    }

    delete props.progress;

    return feature;
  });

  return trimmed;
}

function trimChargingInfo(info: ChargingInfo): ChargingInfo {
  if (!info) return info;

  const p = info.properties ?? {};
  const plug = p.chargingConnectionInfo;
  return {
    type: "Feature",
    geometry: info.geometry,
    properties: {
      chargingParkName: p.chargingParkName,
      chargingParkOperatorName: p.chargingParkOperatorName,
      chargingParkPowerInkW: p.chargingParkPowerInkW,
      chargingParkSpeed: p.chargingParkSpeed,
      chargingTimeInSeconds: p.chargingTimeInSeconds,
      targetChargeInkWh: p.targetChargeInkWh,
      targetChargeInPCT: p.targetChargeInPCT,
      ...(plug
        ? {
            chargingConnectionInfo: {
              plugType: plug.plugType,
              chargingPowerInkW: plug.chargingPowerInkW,
            },
          }
        : {}),
      ...(p.address?.freeformAddress
        ? { address: { freeformAddress: p.address.freeformAddress } }
        : {}),
    },
  };
}
