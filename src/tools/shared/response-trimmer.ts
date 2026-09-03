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

import { type DatasetProvenance, storeDataset } from "../../services/datasets/dataset-store";
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
// Shared GeoJSON Feature Trimming (SDK responses)
// ============================================================================

/**
 * Trim verbose properties from a GeoJSON Feature's properties object.
 * Used by all search-related tools (geocode, fuzzy, POI, nearby, area, EV, along-route).
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
 * Trim FeatureCollection-level metadata (SDK search responses).
 * Removes query timing and internal metadata, keeps result counts.
 */
function trimFeatureCollectionMetadata(resp: Record<string, unknown>): void {
  delete resp.queryTime;
  delete resp.geoBias;
}

/**
 * Trim routing response - removes large coordinate arrays and guidance instructions.
 *
 * SDK format (GeoJSON FeatureCollection):
 *   - features[].geometry.coordinates (full route polyline)
 *   - features[].properties.guidance (turn-by-turn instructions)
 *   - features[].properties.sections[].geometry (section geometry)
 */
export function trimRoutingResponse(response: unknown): unknown {
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

  return response;
}

/**
 * Trim search response - removes verbose POI details and metadata.
 *
 * SDK format (GeoJSON FeatureCollection):
 *   - features[].properties verbose fields are already stripped by the SDK
 */
export function trimSearchResponse(response: unknown): unknown {
  if (!response) return response;
  const resp = response as Record<string, unknown>;

  // SDK format: GeoJSON FeatureCollection with features[]
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

  return response;
}

/**
 * Trim traffic response - removes geometry coordinates and verbose metadata.
 *
 *
 * Removes:
 *   - incidents[].geometry.coordinates (large polyline arrays - 500-1000 chars each)
 *   - incidents[].properties.tmc (traffic message channel codes)
 *   - incidents[].properties.aci (internal codes)
 *   - incidents[].properties.numberOfReports (null in most cases)
 *   - incidents[].properties.lastReportTime (null in most cases)
 *   - incidents[].properties.probabilityOfOccurrence (always "certain")
 *   - incidents[].properties.timeValidity (always "present")
 */
export function trimTrafficResponse(response: unknown): unknown {
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
export function trimReachableRangeResponse(response: unknown): unknown {
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
 * Builds the MCP response: the trimmed projection for the model, plus a
 * `dataset_id` naming the FULL response held server-side.
 *
 * The app redeems that id via the app-only `tomtom-get-dataset`; the model can
 * The app redeems that id; the model has no tool that reads it.
 * One store write serves both.
 */
export async function buildCompressedResponse<T>(
  trimmedData: T,
  fullData: T,
  showUI: boolean = true,
  pretty: boolean = true,
  dataset?: { kind?: ToolDataKind; provenance: DatasetProvenance }
): Promise<MCPResponse> {
  // Compact serialization (no indentation) roughly halves whitespace overhead;
  // used for high-cardinality responses like traffic. Defaults to pretty so
  // other tools' output is unchanged.
  const indent = pretty ? 2 : undefined;

  // Without provenance there is nothing to attribute a dataset to, so skip the
  // store — the caller is a tool that does its own storing (see dynamic-map).
  if (!dataset) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ ...trimmedData, _meta: { show_ui: showUI } }, null, indent),
        },
      ],
    };
  }

  // Always store, even when `show_ui` is false: the app is only ONE consumer of a
  // Always store, even when `show_ui` is false, so the app can redeem the handle
  // for the untrimmed response whether or not anything is being drawn.
  const stored = storeDataset({
    data: fullData,
    kind: dataset.kind,
    provenance: dataset.provenance,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          { ...trimmedData, _meta: { show_ui: showUI, dataset_id: stored.id } },
          null,
          indent
        ),
      },
    ],
  };
}

// ============================================================================
// Per-tool projections
//
// Previously private helpers inside `handlers/searchHandler.ts` and
// `handlers/routingHandler.ts`. Collected here with the rest of the trimmers so
// the whole token-saving layer lives in one file — phase 2 replaces it with
// server-side querying, once the model has a tool that can reach the full data.
// ============================================================================

/** Area/geometry search — properties-only trim; the `_searchBoundary` sidecar is left alone. */
export function trimAreaSearchResponse<T extends { features?: Array<Record<string, unknown>> }>(
  response: T
): T {
  if (!response?.features) return response;
  const trimmed = deepClone(response);
  trimmed.features?.forEach((feature) => {
    trimGeoJSONFeatureProperties((feature.properties ?? {}) as Record<string, unknown>);
  });
  return trimmed;
}

interface ConnectorInfo {
  connector?: {
    type?: string;
    ratedPowerKW?: number;
    currentType?: string;
    chargingSpeed?: string;
  };
  count?: number;
}

/**
 * EV search — flattens each connector to the four fields an agent reasons about
 * and reduces the real-time availability object to its aggregate counts.
 */
export function trimEVSearchResponse<T extends { features?: Array<Record<string, unknown>> }>(
  response: T
): T {
  if (!response?.features) return response;

  const trimmed = deepClone(response);

  trimmed.features?.forEach((feature) => {
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
    // reachable only by the app, through the dataset_id in `_meta`.
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

/** Search-along-route — drops the route polyline and per-POI verbosity. */
export function trimSearchAlongRouteResponse<
  T extends {
    route?: { features?: Array<Record<string, unknown>> };
    pois?: { features?: Array<Record<string, unknown>> };
  },
>(response: T): T {
  const trimmed = deepClone(response);

  trimmed.route?.features?.forEach((feature) => {
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

  trimmed.pois?.features?.forEach((feature) => {
    trimGeoJSONFeatureProperties((feature.properties ?? {}) as Record<string, unknown>);
  });

  return trimmed;
}

interface ChargingInfoProperties {
  chargingParkName?: string;
  chargingParkPowerInkW?: number;
  chargingTimeInSeconds?: number;
  targetChargeInkWh?: number;
  address?: { freeformAddress?: string; [key: string]: unknown };
  [key: string]: unknown;
}

interface ChargingInfo {
  geometry?: unknown;
  properties?: ChargingInfoProperties;
  [key: string]: unknown;
}

interface LegItem {
  summary?: {
    chargingInformationAtEndOfLeg?: ChargingInfo;
    [key: string]: unknown;
  };
  endPointIndex?: number;
  [key: string]: unknown;
}

function trimChargingInfo(info: ChargingInfo): ChargingInfo {
  if (!info) return info;

  const p = info.properties ?? {};
  return {
    type: "Feature",
    geometry: info.geometry,
    properties: {
      chargingParkName: p.chargingParkName,
      chargingParkPowerInkW: p.chargingParkPowerInkW,
      chargingTimeInSeconds: p.chargingTimeInSeconds,
      targetChargeInkWh: p.targetChargeInkWh,
      ...(p.address?.freeformAddress
        ? { address: { freeformAddress: p.address.freeformAddress } }
        : {}),
    },
  };
}

/**
 * Long-distance EV routing — keeps the first/last coordinate of each leg, the
 * leg/country/toll sections, and a reduced charging-stop record per leg.
 */
export function trimEVRoutingResponse<T extends { features?: Array<Record<string, unknown>> }>(
  response: T
): T {
  if (!response?.features) return response;

  const trimmed = deepClone(response);

  trimmed.features?.forEach((feature) => {
    const geom = feature.geometry as { coordinates?: unknown[]; type?: string } | undefined;
    if (geom?.coordinates) {
      const coords = geom.coordinates;
      if (Array.isArray(coords) && coords.length > 2) {
        geom.coordinates = [coords[0], coords[coords.length - 1]];
      }
    }

    const props = (feature.properties ?? {}) as Record<string, unknown>;

    const sections = props.sections as Record<string, unknown> | undefined;
    if (sections) {
      const { leg, country, toll } = sections;
      props.sections = {
        ...(leg ? { leg } : {}),
        ...(country ? { country } : {}),
        ...(toll ? { toll } : {}),
      };

      const updatedSections = props.sections as Record<string, unknown>;
      if (Array.isArray(updatedSections.leg)) {
        updatedSections.leg = (updatedSections.leg as LegItem[]).map((legItem: LegItem) => {
          const ci = legItem.summary?.chargingInformationAtEndOfLeg;
          if (ci && legItem.summary) {
            legItem.summary.chargingInformationAtEndOfLeg = trimChargingInfo(ci);
          }
          return legItem;
        });
      }
    }

    delete props.progress;
  });

  return trimmed;
}
