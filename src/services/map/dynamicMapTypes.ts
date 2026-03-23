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

import type { BBox } from "@tomtom-org/maps-sdk/core";

/**
 * GeoJSON types for map state caching
 */
export interface GeoJSONFeature {
  type: "Feature";
  geometry: {
    type: string;
    coordinates: unknown;
  };
  properties: Record<string, unknown> | null;
}

export interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

/**
 * A single route plan — one origin→destination trip
 */
export interface RoutePlan {
  origin: { lat: number; lon: number; label?: string };
  destination: { lat: number; lon: number; label?: string };
  waypoints?: Array<{ lat: number; lon: number; label?: string }>;
  label?: string;
  routeType?: "fastest" | "shortest" | "eco" | "thrilling";
  travelMode?: "car" | "truck" | "bicycle" | "pedestrian";
  avoid?: string[];
  traffic?: boolean;
  color?: string;
}

/**
 * Dynamic Map display options interface
 */
export interface DynamicMapOptions {
  // Map positioning
  center?: {
    lat: number;
    lon: number;
  };
  bbox?: BBox; // [west, south, east, north]
  zoom?: number;

  // Image dimensions
  width?: number;
  height?: number;

  // Content
  markers?: Array<{
    lat: number;
    lon: number;
    label?: string;
    color?: string;
    priority?: "low" | "normal" | "high" | "critical";
    category?: string;
    description?: string;
    address?: string;
    tags?: string[];
    icon?: string;
  }>;

  // Polygons - Multi-polygon support with circles and polygons
  polygons?: Array<{
    type?: "polygon" | "circle";
    coordinates?: Array<[number, number]>;
    center?: { lat: number; lon: number };
    radius?: number;
    label?: string;
    fillColor?: string;
    strokeColor?: string;
    strokeWidth?: number;
    name?: string;
  }>;

  // Route planning — array of independent route calculations
  routePlans?: RoutePlan[];

  // Display options
  showLabels?: boolean;
  routeInfoDetail?: "basic" | "compact" | "detailed" | "distance-time";
  use_orbis?: boolean;

  // Image response detail level
  detail?: "compact" | "full";
}

/**
 * Response type for dynamic map service
 */
export interface DynamicMapResponse {
  base64: string;
  contentType: string;
  width: number;
  height: number;
  bounds?: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
  center?: [number, number];
  zoom?: number;
  mapState?: CachedMapState;
}

/**
 * Layer definition for MapLibre GL (compatible with both Native and JS)
 */
export interface LayerDefinition {
  id: string;
  type: "circle" | "line" | "fill" | "symbol";
  source: string;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  filter?: unknown[];
}

/**
 * Cached map state for MCP app client-side rendering
 * Contains all data needed to recreate the map with MapLibre GL JS
 */
export interface CachedMapState {
  style: {
    endpoint: string;
    params: Record<string, string>;
    useOrbis: boolean;
  };
  view: {
    center: [number, number]; // [lon, lat]
    zoom: number;
    bounds: {
      north: number;
      south: number;
      east: number;
      west: number;
    };
  };
  sources: {
    markers?: {
      type: "geojson";
      data: GeoJSONFeatureCollection;
    };
    routes?: {
      type: "geojson";
      data: GeoJSONFeatureCollection;
    };
    routeLabels?: {
      type: "geojson";
      data: GeoJSONFeatureCollection;
    };
    polygons?: {
      type: "geojson";
      data: GeoJSONFeatureCollection;
    };
    polygonCenters?: {
      type: "geojson";
      data: GeoJSONFeatureCollection;
    };
  };
  layers: LayerDefinition[];
  options: {
    width: number;
    height: number;
    showLabels: boolean;
  };
}
