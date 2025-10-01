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

import { z } from "zod";

// Coordinate schema for reuse
const coordinateSchema = z.object({
  lat: z.number().describe("Latitude coordinate (-90 to +90). Use precise coordinates from geocoding for best results."),
  lon: z.number().describe("Longitude coordinate (-180 to +180). Use precise coordinates from geocoding for best results."),
  label: z.string().optional().describe("Optional custom label for this location. If not provided, defaults will be used (e.g., 'Start', 'End', 'Waypoint 1')")
});

// Marker schema
const markerSchema = z.object({
  lat: z.number().describe("Marker latitude coordinate"),
  lon: z.number().describe("Marker longitude coordinate"),
  label: z.string().optional().describe("Optional label text for the marker"),
  color: z.string().optional().describe("Marker color in hex format (e.g., '#ff0000' for red). Default: '#ff4444'"),
  priority: z.enum(["low", "normal", "high", "critical"]).optional().describe(
    "Label display priority for crowded areas. Controls which labels are shown when space is limited:\n" +
    "• 'critical' - Always visible (landmarks, primary POIs)\n" +
    "• 'high' - High priority (important businesses, key locations)\n" +
    "• 'normal' - Standard priority (regular POIs) [DEFAULT]\n" +
    "• 'low' - Lower priority (supplementary info, may be hidden in dense areas)\n" +
    "Higher priority labels are displayed first when showLabels=true. Use 'critical' for must-see locations like 'Times Square' or main destinations."
  )
});

// Route point schema (flexible coordinate format)
const routePointSchema = z.union([
  coordinateSchema,
  z.array(z.number()).length(2).describe("Coordinate as [lat, lon] array"),
  z.object({
    coordinates: z.array(z.number()).length(2).describe("Coordinates as {coordinates: [lat, lon]}")
  })
]);

// Route schema
const routeSchema = z.object({
  points: z.array(routePointSchema).describe("Array of route points in various coordinate formats"),
  name: z.string().optional().describe("Optional route name"),
  color: z.string().optional().describe("Route color in hex format (e.g., '#0066cc')")
});

// Polygon schema (Phase 2: Multi-polygon support with circles and polygons)
const polygonSchema = z.object({
  // Geometry type
  type: z.enum(["polygon", "circle"]).optional().describe("Shape type: 'polygon' for custom shapes, 'circle' for circular areas. Default: 'polygon'"),
  
  // Polygon coordinates (for type: 'polygon')
  coordinates: z.array(z.array(z.number()).length(2))
    .min(3)
    .optional()
    .describe("Array of coordinate pairs [lon, lat] forming the polygon boundary. Required for type='polygon'. Minimum 3 points required."),
  
  // Circle properties (for type: 'circle')
  center: z.object({
    lat: z.number().describe("Circle center latitude"),
    lon: z.number().describe("Circle center longitude")
  }).optional().describe("Center point for circles. Required for type='circle'."),
  
  radius: z.number().min(1).optional().describe("Circle radius in meters. Required for type='circle'. Examples: 500 (small area), 2000 (neighborhood), 5000 (district)."),
  
  // Styling (applies to both polygons and circles)
  label: z.string().optional().describe("Optional text label to display in the shape center"),
  
  fillColor: z.string().optional().describe("Fill color in CSS format. Examples: '#ff0000', 'rgba(255,0,0,0.3)', 'red'. Default: 'rgba(0,123,255,0.3)'"),
  
  strokeColor: z.string().optional().describe("Border color in CSS format. Examples: '#ff0000', 'blue'. Default: '#007bff'"),
  
  strokeWidth: z.number().min(0).max(10).optional().describe("Border width in pixels (0-10). Default: 2"),
  
  name: z.string().optional().describe("Optional polygon name for identification")
});

/**
 * Dynamic Map Schema for advanced map rendering with custom markers, routes, and styling
 */
export const tomtomDynamicMapSchema = {
  // Map positioning - either center+zoom, bbox, or auto-calculated from content
  center: coordinateSchema.optional().describe(
    "Map center coordinates. Optional if bbox provided or if markers/routes are used for auto-calculation."
  ),

  bbox: z
    .array(z.number())
    .length(4)
    .optional()
    .describe(
      "Bounding box in format [west, south, east, north]. Alternative to center+zoom. Example: [-122.42, 37.77, -122.40, 37.79] for part of San Francisco."
    ),

  zoom: z
    .number()
    .min(0)
    .max(22)
    .optional()
    .describe(
      "Zoom level (0-22). Examples: 3 (continent), 6 (country), 10 (city), 15 (neighborhood), 18 (street). Auto-calculated if not provided."
    ),

  // Image dimensions - auto-calculated if not provided
  width: z
    .number()
    .min(100)
    .max(2048)
    .optional()
    .describe(
      "Map width in pixels (100-2048). Auto-calculated based on content if not provided. Examples: 800 (standard), 1200 (detailed)."
    ),

  height: z
    .number()
    .min(100)
    .max(2048)
    .optional()
    .describe(
      "Map height in pixels (100-2048). Auto-calculated based on content if not provided. Examples: 600 (standard), 900 (detailed)."
    ),

  // Content to render
  markers: z
    .array(markerSchema)
    .optional()
    .describe(
      "Array of markers to display on the map. Each marker can have custom color and label."
    ),

  routes: z
    .array(routeSchema)
    .optional()
    .describe(
      "Array of routes to display on the map. Routes will be styled with traffic-aware coloring if route data is provided."
    ),

  polygons: z
    .array(polygonSchema)
    .optional()
    .describe(
      "Array of polygons and circles to display on the map. Supports both custom polygon shapes (with coordinate arrays) and circular areas (with center point and radius). Each shape can have custom styling and labels."
    ),

  // Route planning mode (auto-detected when origin and destination provided)
  origin: coordinateSchema
    .optional()
    .describe(
      "Origin point for route planning. When provided with destination, triggers automatic route calculation. Can include optional 'label' field. Default label: 'Start'."
    ),

  destination: coordinateSchema
    .optional()
    .describe(
      "Destination point for route planning. When provided with origin, triggers automatic route calculation. Can include optional 'label' field. Default label: 'End'."
    ),

  waypoints: z
    .array(coordinateSchema)
    .optional()
    .describe(
      "Optional waypoints for route planning. Each can include optional 'label' field. Default labels: 'Waypoint 1', 'Waypoint 2', etc."
    ),

  // Display options
  showLabels: z
    .boolean()
    .optional()
    .describe(
      "Whether to show text labels on markers and routes. Default: false."
    ),

  routeLabel: z
    .string()
    .optional()
    .describe(
      "Custom label for routes. Used when showLabels=true."
    ),

  routeInfoDetail: z
    .enum(["basic", "compact", "detailed", "distance-time"])
    .optional()
    .describe(
      "Level of route information to display: 'basic' (simple), 'compact' (short), 'detailed' (full), 'distance-time' (time/distance only)."
    )
};