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

import axios from "axios";
import { logger } from "../utils/logger";
import { storeVizData } from "../services/cache/vizCache";
import type { BBox } from "@tomtom-org/maps-sdk/core";

const MAX_URL_SIZE = 50 * 1024 * 1024; // 50MB for URL fetch
const MAX_INLINE_SIZE = 10 * 1024 * 1024; // 10MB for inline GeoJSON
const MAX_FEATURES = 100_000; // 100K features
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
    throw new Error("Invalid GeoJSON: data is not an object");
  }
  const obj = data as Record<string, unknown>;

  if (obj.type === "FeatureCollection") {
    if (!Array.isArray(obj.features)) {
      throw new Error("Invalid GeoJSON: FeatureCollection missing 'features' array");
    }
    return obj as unknown as GeoJSONFeatureCollection;
  }

  if (obj.type === "Feature") {
    return { type: "FeatureCollection", features: [obj as unknown as GeoJSONFeature] };
  }

  // Bare geometry — wrap in Feature then FeatureCollection
  if (obj.type && obj.coordinates) {
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: obj as { type: string; coordinates: unknown },
          properties: {},
        },
      ],
    };
  }

  throw new Error(
    `Invalid GeoJSON: expected FeatureCollection, Feature, or Geometry. Got type="${String(obj.type)}"`
  );
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

async function fetchGeoJSON(url: string): Promise<unknown> {
  const response = await axios.get(url, {
    timeout: FETCH_TIMEOUT,
    maxContentLength: MAX_URL_SIZE,
    maxBodyLength: MAX_URL_SIZE,
    headers: { Accept: "application/geo+json, application/json" },
    responseType: "json",
  });
  return response.data;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

interface VizLayer {
  type: string;
  color_property?: string;
  [key: string]: unknown;
}

export function createDataVizHandler() {
  return async (params: Record<string, unknown>) => {
    try {
      const show_ui = (params.show_ui ?? true) as boolean;
      const data_url = params.data_url as string | undefined;
      const geojson = params.geojson as string | undefined;
      const layers = params.layers as VizLayer[];
      const title = params.title as string | undefined;

      // Validate mutual exclusivity
      if (!data_url && !geojson) {
        throw new Error("Either 'data_url' or 'geojson' parameter must be provided");
      }
      if (data_url && geojson) {
        throw new Error("'data_url' and 'geojson' are mutually exclusive — provide only one");
      }

      // Validate layer count
      if (layers.length > MAX_LAYERS) {
        throw new Error(`Too many layers: ${layers.length}. Maximum is ${MAX_LAYERS}.`);
      }

      // Validate choropleth requires color_property
      for (const layer of layers) {
        if (layer.type === "choropleth" && !layer.color_property) {
          throw new Error("'choropleth' layer type requires 'color_property'");
        }
      }

      logger.info(
        { data_url, hasInline: !!geojson, layerCount: layers.length, title },
        "Data viz request"
      );

      // Fetch or parse GeoJSON
      let rawData: unknown;
      if (data_url) {
        rawData = await fetchGeoJSON(data_url);
      } else {
        // Validate inline GeoJSON size
        if (geojson!.length > MAX_INLINE_SIZE) {
          const sizeMB = (geojson!.length / (1024 * 1024)).toFixed(1);
          throw new Error(
            `Inline GeoJSON too large: ${sizeMB}MB. Maximum is ${MAX_INLINE_SIZE / (1024 * 1024)}MB. ` +
              `For large datasets, host the file and use 'data_url' instead (up to ${MAX_URL_SIZE / (1024 * 1024)}MB).`
          );
        }
        try {
          rawData = JSON.parse(geojson!) as unknown;
        } catch {
          throw new Error("Invalid 'geojson' parameter: failed to parse JSON string");
        }
      }

      // Normalize to FeatureCollection
      const fc = normalizeToFeatureCollection(rawData);

      if (fc.features.length === 0) {
        throw new Error("GeoJSON contains no features");
      }

      // Validate feature count
      if (fc.features.length > MAX_FEATURES) {
        throw new Error(
          `Too many features: ${fc.features.length.toLocaleString()}. Maximum is ${MAX_FEATURES.toLocaleString()}. ` +
            `Consider filtering or aggregating the data before visualization.`
        );
      }

      // Compute summary for agent context
      const summary = computeSummary(fc);

      logger.info(
        { featureCount: summary.feature_count, geometryTypes: summary.geometry_types },
        "Data viz: GeoJSON processed"
      );

      // Store full data + layer config in vizCache
      const vizPayload = { geojson: fc, layers, title, bbox: summary.bbox };
      const vizId = await storeVizData(vizPayload);

      // Return summary (no coordinates) to agent, viz_id for the App
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                summary,
                layers_applied: layers.map((l) => l.type),
                title: title || null,
                _meta: { show_ui, viz_id: vizId },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "Data viz failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}
