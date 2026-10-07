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
 * Handler for BYOD Data Visualization tool.
 * Fetches/parses GeoJSON data, validates it, computes a summary for the agent,
 * and caches the full data for the App to retrieve.
 */

import { lookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import type { BBox } from "@tomtom-org/maps-sdk/core";
import axios from "axios";
import * as ipaddr from "ipaddr.js";
import type { DataVizParams } from "../schemas/dataViz/dataVizSchema";
import { storeVizData } from "../services/cache/vizCache";
import { IncorrectError } from "../types/types";
import { logger } from "../utils/logger";
import { buildErrorResponse } from "./shared/responseTrimmer";

const MAX_URL_SIZE = 50 * 1024 * 1024; // 50MB for URL fetch
const MAX_INLINE_SIZE = 10 * 1024 * 1024; // 10MB for inline GeoJSON
const MAX_FEATURES = 100_000;
const MAX_LAYERS = 10;
const FETCH_TIMEOUT = 30_000; // 30s

// ---------------------------------------------------------------------------
// GeoJSON types (minimal)
// ---------------------------------------------------------------------------

interface GeoJSONFeature {
  type: "Feature";
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown> | null;
}

interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

// ---------------------------------------------------------------------------
// Normalization & validation
// ---------------------------------------------------------------------------

function normalizeToFeatureCollection(data: unknown): GeoJSONFeatureCollection {
  if (!data || typeof data !== "object") {
    throw new IncorrectError("Invalid GeoJSON: data is not an object");
  }
  const record = data as Record<string, unknown>;

  if (record.type === "FeatureCollection") {
    if (!Array.isArray(record.features)) {
      throw new IncorrectError("Invalid GeoJSON: FeatureCollection missing 'features' array");
    }
    return record as unknown as GeoJSONFeatureCollection;
  }

  if (record.type === "Feature") {
    return { type: "FeatureCollection", features: [record as unknown as GeoJSONFeature] };
  }

  // Bare geometry — wrap in Feature then FeatureCollection
  if (record.type && record.coordinates) {
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: record as { type: string; coordinates: unknown },
          properties: {},
        },
      ],
    };
  }

  throw new IncorrectError("Invalid GeoJSON: expected a FeatureCollection, Feature or Geometry", {
    type: String(record.type),
  });
}

// ---------------------------------------------------------------------------
// Summary computation
// ---------------------------------------------------------------------------

interface DataSummary {
  feature_count: number;
  geometry_types: string[];
  bbox: BBox | null;
  property_names: string[];
  numeric_properties: string[];
  sample_properties: Record<string, unknown> | null;
}

function computeBbox(fc: GeoJSONFeatureCollection): BBox | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  let found = false;

  function processCoord(coord: number[]) {
    if (coord.length >= 2) {
      found = true;
      if (coord[0] < minLng) minLng = coord[0];
      if (coord[0] > maxLng) maxLng = coord[0];
      if (coord[1] < minLat) minLat = coord[1];
      if (coord[1] > maxLat) maxLat = coord[1];
    }
  }

  function walkCoords(coords: unknown) {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number") {
      processCoord(coords as number[]);
    } else {
      for (const c of coords) walkCoords(c);
    }
  }

  for (const feature of fc.features) {
    if (feature.geometry?.coordinates) {
      walkCoords(feature.geometry.coordinates);
    }
  }

  return found ? [minLng, minLat, maxLng, maxLat] : null;
}

function computeSummary(fc: GeoJSONFeatureCollection): DataSummary {
  const geometryTypes = new Set<string>();
  const propertyNames = new Set<string>();
  const numericProperties = new Set<string>();
  let sampleProps: Record<string, unknown> | null = null;

  for (const feature of fc.features) {
    if (feature.geometry?.type) {
      geometryTypes.add(feature.geometry.type);
    }

    const props = feature.properties;
    if (props) {
      if (!sampleProps) sampleProps = { ...props };

      for (const [key, value] of Object.entries(props)) {
        propertyNames.add(key);
        if (typeof value === "number") {
          numericProperties.add(key);
        }
      }
    }
  }

  return {
    feature_count: fc.features.length,
    geometry_types: [...geometryTypes],
    bbox: computeBbox(fc),
    property_names: [...propertyNames],
    numeric_properties: [...numericProperties],
    sample_properties: sampleProps,
  };
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function validateUrl(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new IncorrectError("Invalid URL format");
  }

  if (parsed.protocol !== "https:") {
    throw new IncorrectError("Only https URLs are allowed");
  }

  if (parsed.username || parsed.password) {
    throw new IncorrectError("URLs with credentials are not allowed");
  }

  const hostname = parsed.hostname;

  // Resolve DNS to get the actual IP (or use the IP literal directly)
  let resolvedIp: string;
  if (isIP(hostname)) {
    resolvedIp = hostname;
  } else {
    const result = await lookup(hostname);
    resolvedIp = result.address;
  }

  // ipaddr.js classifies the IP — only allow "unicast" (public internet)
  const addr = ipaddr.process(resolvedIp);
  if (addr.range() !== "unicast") {
    logger.warn({ hostname, resolvedIp, range: addr.range() }, "Blocked non-public URL");
    throw new IncorrectError("URL resolves to a non-public IP address");
  }

  return resolvedIp;
}

async function fetchGeoJSON(url: string): Promise<unknown> {
  const resolvedIp = await validateUrl(url);

  // Pin DNS to the validated IP to prevent DNS rebinding.
  // Node 20+ enables autoSelectFamily (Happy Eyeballs) by default, which calls
  // lookup with { all: true } and expects an array of { address, family }
  // entries — answering with a plain string there makes net read
  // addresses[0].address as undefined ("Invalid IP address: undefined").
  const agent = new https.Agent({
    lookup: (_hostname, options, callback) => {
      const family = isIP(resolvedIp) === 6 ? 6 : 4;
      if (options.all) {
        callback(null, [{ address: resolvedIp, family }]);
      } else {
        callback(null, resolvedIp, family);
      }
    },
  });

  try {
    const response = await axios.get(url, {
      timeout: FETCH_TIMEOUT,
      maxContentLength: MAX_URL_SIZE,
      maxBodyLength: MAX_URL_SIZE,
      headers: { Accept: "application/geo+json, application/json" },
      responseType: "json",
      httpsAgent: agent,
      maxRedirects: 0,
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      throw new IncorrectError(
        "data_url returned an HTTP error",
        { status: error.response.status },
        { cause: error }
      );
    }
    throw error;
  } finally {
    agent.destroy();
  }
}

export function createDataVizHandler() {
  return async (params: DataVizParams) => {
    try {
      const { show_ui = true, data_url, geojson, layers, title } = params;

      // Validate mutual exclusivity
      if (!data_url && !geojson) {
        throw new IncorrectError("Either 'data_url' or 'geojson' parameter must be provided");
      }
      if (data_url && geojson) {
        throw new IncorrectError(
          "'data_url' and 'geojson' are mutually exclusive — provide only one"
        );
      }

      if (layers.length > MAX_LAYERS) {
        throw new IncorrectError("Too many layers", {
          layerCount: layers.length,
          maxLayers: MAX_LAYERS,
        });
      }

      for (const layer of layers) {
        if (layer.type === "choropleth" && !layer.color_property) {
          throw new IncorrectError("'choropleth' layer type requires 'color_property'");
        }
      }

      logger.info(
        { data_url, hasInline: !!geojson, layerCount: layers.length, title },
        "Data viz request"
      );

      let rawData: unknown;
      if (data_url) {
        rawData = await fetchGeoJSON(data_url);
      } else {
        if (geojson!.length > MAX_INLINE_SIZE) {
          throw new IncorrectError(
            "Inline GeoJSON too large. For large datasets, host the file and use 'data_url' instead.",
            {
              sizeBytes: geojson!.length,
              maxInlineBytes: MAX_INLINE_SIZE,
              maxUrlBytes: MAX_URL_SIZE,
            }
          );
        }
        try {
          rawData = JSON.parse(geojson!) as unknown;
        } catch {
          throw new IncorrectError("Invalid 'geojson' parameter: failed to parse JSON string");
        }
      }

      const fc = normalizeToFeatureCollection(rawData);

      if (fc.features.length === 0) {
        throw new IncorrectError("GeoJSON contains no features");
      }

      if (fc.features.length > MAX_FEATURES) {
        throw new IncorrectError(
          "Too many features. Filter or aggregate the data before visualizing it.",
          { featureCount: fc.features.length, maxFeatures: MAX_FEATURES }
        );
      }

      // Compute summary for agent context
      const summary = computeSummary(fc);

      logger.info(
        { featureCount: summary.feature_count, geometryTypes: summary.geometry_types },
        "Data viz: GeoJSON processed"
      );

      const vizPayload = { geojson: fc, layers, title, bbox: summary.bbox };
      const vizId = await storeVizData(vizPayload);

      // Return summary (no coordinates) to agent, viz_id for the App
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              summary,
              layers_applied: layers.map((l) => l.type),
              title: title || null,
              _meta: { show_ui, viz_id: vizId },
            }),
          },
        ],
      };
    } catch (error: unknown) {
      return buildErrorResponse(error, "Data visualization");
    }
  };
}
