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

/**
 * Map display options interface
 */
export interface MapOptions {
  /**
   * Zoom level (0-22)
   * 0: World, 6: Country, 10: City, 15: Streets, 19: Buildings
   */
  zoom?: number;

  /**
   * Map center coordinates
   * Either center or bbox must be provided
   */
  center?: {
    lat: number;
    lon: number;
  };

  /**
   * Bounding box in format [west, south, east, north]
   * Alternative to center+zoom for defining the map area
   * Either center or bbox must be provided
   */
  bbox?: [number, number, number, number];

  /**
   * Map image width in pixels (1-8192)
   */
  width?: number;

  /**
   * Map image height in pixels (1-8192)
   */
  height?: number;

  /**
   * Map style
   */
  style?: "main" | "night";

  /**
   * Map layer type
   * - basic: Streets and basic features
   * - labels: Text labels only (transparent background)
   * - hybrid: Satellite imagery with labels
   */
  layer?: "basic" | "labels" | "hybrid";

  /**
   * Image format
   * - png: Better for maps with transparency
   * - jpg: Smaller file size for maps without transparency
   */
  format?: "png" | "jpg";

  /**
   * Geopolitical view for border disputes and territories
   */
  view?: "Unified" | "IL" | "IN" | "MA" | "PK" | "AR" | "Arabic" | "RU" | "TR" | "CN" | "US";

  /**
   * Language for map labels (IETF language tag)
   */
  language?: string;
}

/**
 * Default values for map options
 */
export const DEFAULT_MAP_OPTIONS = {
  width: 512,
  height: 512,
  style: "main" as const,
  layer: "basic" as const,
  view: "Unified" as const,
  format: "png" as const,
  zoom: 12,
};

/**
 * Handler parameter types for map operations
 */
export interface StaticMapParams {
  center: {
    lat: number;
    lon: number;
  };
  [key: string]: unknown;
}

export interface DynamicMapParams {
  use_orbis?: boolean;
  [key: string]: unknown;
}
