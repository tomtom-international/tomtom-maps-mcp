/*
 * Copyright (C) 2025 TomTom NV
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
 * Dynamic Map display options interface
 */
export interface DynamicMapOptions {
  // Map positioning
  center?: {
    lat: number;
    lon: number;
  };
  bbox?: [number, number, number, number]; // [west, south, east, north]
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
  }>;

  // Route planning mode - intelligent route calculation
  isRoute?: boolean;
  origin?: {
    lat: number;
    lon: number;
  };
  destination?: {
    lat: number;
    lon: number;
  };
  waypoints?: Array<{
    lat: number;
    lon: number;
  }>;

  // Route calculation options
  routeType?: "fastest" | "shortest" | "eco" | "thrilling";
  travelMode?: "car" | "truck" | "bicycle" | "pedestrian";
  avoid?: string[];
  traffic?: boolean;

  // Display options
  showLabels?: boolean;
  routeLabel?: string;
  routeInfoDetail?: "basic" | "compact" | "detailed" | "distance-time";

  // Environment
  use_orbis?: boolean;
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
}
