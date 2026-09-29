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

import type { DynamicMapParams } from "../../schemas/map/dynamicMapSchema";

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

export type DynamicMapOptions = Omit<DynamicMapParams, "show_ui">;

export type MapMarker = NonNullable<DynamicMapOptions["markers"]>[number];
export type MapPolygon = NonNullable<DynamicMapOptions["polygons"]>[number];
export type DirectRoute = NonNullable<DynamicMapOptions["routes"]>[number];
/** A single route plan — one origin→destination trip */
export type RoutePlan = NonNullable<DynamicMapOptions["routePlans"]>[number];

/**
 * Response type for dynamic map service
 */
export interface DynamicMapResponse {
  /** Viewport the state was fitted to, in pixels. */
  width: number;
  height: number;
  /** Style, viewport, sources and layers for the interactive app to render. */
  mapState: CachedMapState;
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

export type MapSourceName = "markers" | "routes" | "routeLabels" | "polygons" | "polygonCenters";

/**
 * Cached map state for MCP app client-side rendering
 * Contains all data needed to recreate the map with MapLibre GL JS
 */
export interface CachedMapState {
  style: {
    endpoint: string;
    params: Record<string, string>;
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
  sources: Partial<Record<MapSourceName, { type: "geojson"; data: GeoJSONFeatureCollection }>>;
  layers: LayerDefinition[];
  options: {
    width: number;
    height: number;
    showLabels: boolean;
  };
}
