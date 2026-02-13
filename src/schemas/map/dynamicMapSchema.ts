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

import { z } from "zod";

/**
 * TomTom Dynamic Map Schema
 *
 * This schema defines parameters for generating interactive and static maps with
 * custom markers, routes, polygons, and other visualizations.
 *
 * AUTO-CALCULATION BEHAVIOR:
 * - If no 'bbox', 'center', or 'zoom' is provided, the map will automatically adjust to show all elements.
 * - When both 'routes' and 'markers' are provided, the view will prioritize showing all route elements.
 * - For best control, always provide either 'bbox' or 'center'+'zoom' explicitly.
 * - The map will auto-adjust width/height to maintain proper aspect ratio unless both are specified.
 * - Specifying larger width/height values will result in higher resolution maps.
 *
 * COMMON USE PATTERNS:
 * 1. Simple marker map: Provide 'markers' array and let width/height/zoom auto-calculate
 * 2. Route planning: Provide 'origin' and 'destination' for automatic route calculation
 * 3. Custom area visualization: Use 'polygons' with either polygon or circle types
 * 4. Fixed viewpoint: Specify exact 'bbox' or 'center'+'zoom' to control the map view
 */

const waypointCoordinateSchema = z.object({
  lat: z
    .number()
    .describe(
      "Latitude coordinate (-90 to +90). Use precise coordinates from geocoding for best results. EXAMPLE: 52.3676 for Amsterdam Central Station."
    ),
  lon: z
    .number()
    .describe(
      "Longitude coordinate (-180 to +180). Use precise coordinates from geocoding for best results. EXAMPLE: 4.9041 for Amsterdam Central Station."
    ),
  label: z
    .string()
    .optional()
    .describe(
      "Optional custom label for this location. If not provided, defaults will be used (e.g., 'Start', 'End', 'Waypoint 1'). EXAMPLE: 'Amsterdam Central' or 'Coffee Stop'."
    ),
});

// Coordinate schema for reuse
const routeCoordinateSchema = z.object({
  lat: z
    .number()
    .describe(
      "Latitude coordinate (-90 to +90). Use precise coordinates from geocoding for best results. EXAMPLE: 52.3676 for Amsterdam Central Station."
    ),
  lon: z
    .number()
    .describe(
      "Longitude coordinate (-180 to +180). Use precise coordinates from geocoding for best results. EXAMPLE: 4.9041 for Amsterdam Central Station."
    ),
  label: z
    .string()
    .optional()
    .describe(
      "Optional custom label for this location. If not provided, defaults will be used (e.g., 'Start', 'End', 'Waypoint 1'). EXAMPLE: 'Amsterdam Central' or 'First Stop'."
    ),
});

const centerCoordinateSchema = z.object({
  lat: z
    .number()
    .describe(
      "Latitude coordinate (-90 to +90). Use precise coordinates from geocoding for best results. EXAMPLE: 52.3676 for Amsterdam Central Station."
    ),
  lon: z
    .number()
    .describe(
      "Longitude coordinate (-180 to +180). Use precise coordinates from geocoding for best results. EXAMPLE: 4.9041 for Amsterdam Central Station."
    ),
  label: z
    .string()
    .optional()
    .describe(
      "Optional custom label for the map center. This label will only appear if the center point is also added to markers. EXAMPLE: 'Map Center'."
    ),
});

const originCoordinateSchema = z.object({
  lat: z
    .number()
    .describe(
      "Latitude coordinate (-90 to +90). Use precise coordinates from geocoding for best results. EXAMPLE: 52.3676 for Amsterdam Central Station."
    ),
  lon: z
    .number()
    .describe(
      "Longitude coordinate (-180 to +180). Use precise coordinates from geocoding for best results. EXAMPLE: 4.9041 for Amsterdam Central Station."
    ),
  label: z
    .string()
    .optional()
    .describe(
      "Optional custom label for the starting point. If not provided, defaults to 'Start'. EXAMPLE: 'Home' or 'Office'."
    ),
});

const destinationCoordinateSchema = z.object({
  lat: z
    .number()
    .describe(
      "Latitude coordinate (-90 to +90). Use precise coordinates from geocoding for best results. EXAMPLE: 52.36 for Rijksmuseum."
    ),
  lon: z
    .number()
    .describe(
      "Longitude coordinate (-180 to +180). Use precise coordinates from geocoding for best results. EXAMPLE: 4.8852 for Rijksmuseum."
    ),
  label: z
    .string()
    .optional()
    .describe(
      "Optional custom label for the end point. If not provided, defaults to 'End'. EXAMPLE: 'Restaurant' or 'Museum'."
    ),
});

// Marker schema
const markerSchema = z.object({
  lat: z
    .number()
    .describe("Marker latitude coordinate. EXAMPLE: 52.3676 for Amsterdam Central Station."),
  lon: z
    .number()
    .describe("Marker longitude coordinate. EXAMPLE: 4.9041 for Amsterdam Central Station."),
  label: z
    .string()
    .optional()
    .describe("Optional label text for the marker. EXAMPLE: 'Amsterdam Central' or 'My Location'."),
  color: z
    .string()
    .optional()
    .describe(
      "Marker color in hex format (e.g., '#ff0000' for red). DEFAULT: '#ff4444'. EXAMPLE: '#00FF00' for green, '#0000FF' for blue."
    ),
  priority: z
    .enum(["low", "normal", "high", "critical"])
    .optional()
    .describe(
      "Label display priority for crowded areas. Controls which labels are shown when space is limited:\n" +
        "• 'critical' - Always visible (landmarks, primary POIs)\n" +
        "• 'high' - High priority (important businesses, key locations)\n" +
        "• 'normal' - Standard priority (regular POIs) [DEFAULT]\n" +
        "• 'low' - Lower priority (supplementary info, may be hidden in dense areas)\n" +
        "Higher priority labels are displayed first when showLabels=true. Use 'critical' for must-see locations like 'Times Square' or main destinations. EXAMPLE: Use 'critical' for your main destination and 'normal' for secondary points."
    ),
});

// Route schema
const routeSchema = z.object({
  points: z
    .array(routeCoordinateSchema)
    .describe(
      "Array of route points in various coordinate formats. EXAMPLE: For a simple route from Amsterdam Central to Rijksmuseum: [{lat: 52.3676, lon: 4.9041, label: 'Start'}, {lat: 52.36, lon: 4.8852, label: 'End'}]"
    ),
  name: z
    .string()
    .optional()
    .describe(
      "Optional route name that appears when showLabels=true. EXAMPLE: 'Walking Tour' or 'Scenic Drive'."
    ),
  color: z
    .string()
    .optional()
    .describe(
      "Route color in hex format (e.g., '#0066cc'). DEFAULT: system-defined color based on traffic conditions. EXAMPLE: '#FF0000' for red route, '#00FF00' for green route."
    ),
});

// Polygon schema (Phase 2: Multi-polygon support with circles and polygons)
const polygonSchema = z.object({
  // Geometry type
  type: z
    .enum(["polygon", "circle"])
    .optional()
    .describe(
      "Shape type: 'polygon' for custom shapes, 'circle' for circular areas. DEFAULT: 'polygon'. EXAMPLE: For a triangle around Amsterdam, use type: 'polygon' with coordinates: [[4.9041, 52.3676], [4.8979, 52.3745], [4.8852, 52.36], [4.9041, 52.3676]]."
    ),

  // Polygon coordinates (for type: 'polygon')
  coordinates: z
    .array(z.array(z.number()).length(2))
    .min(3)
    .optional()
    .describe(
      "Array of coordinate pairs in [longitude, latitude] format (NOTE: longitude first, latitude second) forming the polygon boundary. Required for type='polygon'. Minimum 3 points required. To create a closed polygon, the first and last coordinates must be identical. EXAMPLE: [[4.9041, 52.3676], [4.8979, 52.3745], [4.8852, 52.36], [4.9041, 52.3676]] creates a triangle with the last point closing the shape."
    ),

  // Circle properties (for type: 'circle')
  center: z
    .object({
      lat: z.number().describe("Circle center latitude. EXAMPLE: 52.3676 for Amsterdam Central."),
      lon: z.number().describe("Circle center longitude. EXAMPLE: 4.9041 for Amsterdam Central."),
    })
    .optional()
    .describe(
      "Center point for circles. Required for type='circle'. EXAMPLE: {lat: 52.3676, lon: 4.9041} for Amsterdam Central."
    ),

  radius: z
    .number()
    .min(1)
    .optional()
    .describe(
      "Circle radius in meters. Required for type='circle'. Examples: 500 (small area), 2000 (neighborhood), 5000 (district). EXAMPLE: 1000 for a 1km radius around a point."
    ),

  // Styling (applies to both polygons and circles)
  label: z
    .string()
    .optional()
    .describe(
      "Optional text label to display in the shape center. EXAMPLE: 'Tourist Area' or '5min Walk Distance'."
    ),

  fillColor: z
    .string()
    .optional()
    .describe(
      "Fill color in CSS format. DEFAULT: 'rgba(0,123,255,0.3)' (transparent blue). EXAMPLE: 'rgba(255,0,0,0.3)' for transparent red, '#00FF00' for solid green. Lower alpha values (0.1-0.3) work best for large areas to avoid obscuring map details."
    ),

  strokeColor: z
    .string()
    .optional()
    .describe(
      "Border color in CSS format. DEFAULT: '#007bff'. EXAMPLE: '#FF0000' for red border, 'blue' for blue border."
    ),

  strokeWidth: z
    .number()
    .min(0)
    .max(10)
    .optional()
    .describe(
      "Border width in pixels (0-10). DEFAULT: 2. EXAMPLE: 0 for no border, 5 for thick border."
    ),

  name: z
    .string()
    .optional()
    .describe(
      "Optional polygon name for identification (not displayed on map). EXAMPLE: 'serviceArea' or 'district5'."
    ),
});

// Refined polygon schema with additional validation
const refinedPolygonSchema = polygonSchema.refine(
  (data) => {
    if (data.type === "polygon")
      return Array.isArray(data.coordinates) && data.coordinates.length >= 3;
    if (data.type === "circle") return data.center && typeof data.radius === "number";
    return true;
  },
  {
    message:
      "For type='polygon', 'coordinates' array is required. For type='circle', both 'center' and 'radius' are required.",
  }
);

/**
 * Dynamic Map Schema for advanced map rendering with custom markers, routes, and styling
 *
 * COMMON PATTERNS:
 * 1. Simple marker map: Provide 'markers' array and let width/height/zoom auto-calculate
 * 2. Route planning: Provide 'origin' and 'destination' for automatic route calculation
 * 3. Custom area visualization: Use 'polygons' with either polygon or circle types
 * 4. Fixed viewpoint: Specify exact 'bbox' or 'center'+'zoom' to control the map view
 *
 * AUTO-CALCULATION BEHAVIOR:
 * - If no 'bbox', 'center', or 'zoom' is provided, the map will automatically adjust to show all elements.
 * - When both 'routes' and 'markers' are provided, the view will prioritize showing all route elements.
 * - For best control, always provide either 'bbox' or 'center'+'zoom' explicitly.
 * - The map will auto-adjust width/height to maintain proper aspect ratio unless both are specified.
 */
export const tomtomDynamicMapSchema = {
  // Map positioning - either center+zoom, bbox, or auto-calculated from content
  center: centerCoordinateSchema
    .optional()
    .describe(
      "Map center coordinates. Optional if bbox provided or if markers/routes are used for auto-calculation. IMPORTANT: If using 'center', also provide 'zoom' for best results. Use either center+zoom OR bbox, not both simultaneously. EXAMPLE: {lat: 52.3676, lon: 4.9041} for Amsterdam Central."
    ),

  bbox: z
    .array(z.number())
    .length(4)
    .optional()
    .describe(
      "Bounding box in format [west, south, east, north] (min longitude, min latitude, max longitude, max latitude). Alternative to center+zoom. Use this parameter to ensure all map elements are fully visible. EXAMPLE: [4.87, 52.355, 4.915, 52.385] for central Amsterdam area."
    ),

  zoom: z
    .number()
    .min(0)
    .max(22)
    .optional()
    .describe(
      "Zoom level (0-22). EXAMPLES: 3 (continent), 6 (country), 10 (city), 15 (neighborhood), 18 (street), 20-22 (building detail). Auto-calculated if not provided. NOTE: Zoom levels 20+ are only useful for very small geographic areas."
    ),

  // Image dimensions - auto-calculated if not provided
  width: z
    .number()
    .min(100)
    .max(2048)
    .optional()
    .describe(
      "Map width in pixels (100-2048). Auto-calculated based on content if not provided. Recommended values: 800 (standard), 1200 (detailed). EXAMPLE: 800 for standard display, 1200 for detailed map."
    ),

  height: z
    .number()
    .min(100)
    .max(2048)
    .optional()
    .describe(
      "Map height in pixels (100-2048). Auto-calculated based on content if not provided. Recommended values: 600 (standard), 900 (detailed). EXAMPLE: 600 for standard display, 900 for detailed map."
    ),

  // Content to render
  markers: z
    .array(markerSchema)
    .optional()
    .describe(
      "Array of markers to display on the map. Each marker can have custom color, label, and priority. EXAMPLE: [{lat: 52.3676, lon: 4.9041, color: '#FF4444', label: 'Amsterdam Central', priority: 'high'}]."
    ),

  routes: z
    .array(routeSchema)
    .optional()
    .describe(
      "Array of routes to display on the map. Each route requires an array of points with lat/lon coordinates. For complex routes with turn-by-turn navigation, use origin/destination parameters instead. Routes defined here are simple point-to-point connections. EXAMPLE: [{points: [{lat: 52.3676, lon: 4.9041}, {lat: 52.36, lon: 4.8852}], color: '#0000FF', name: 'Direct Route'}]."
    ),

  polygons: z
    .array(refinedPolygonSchema)
    .optional()
    .describe(
      "Array of polygons and circles to display on the map. Supports both custom polygon shapes (with coordinate arrays) and circular areas (with center point and radius). Each shape can have custom styling and labels. EXAMPLE for polygon: [{type: 'polygon', coordinates: [[4.9041, 52.3676], [4.8979, 52.3745], [4.8852, 52.36], [4.9041, 52.3676]], fillColor: 'rgba(255,0,0,0.3)', label: 'Tourist Area'}]. EXAMPLE for circle: [{type: 'circle', center: {lat: 52.3676, lon: 4.9041}, radius: 1000, fillColor: 'rgba(0,0,255,0.2)', label: '1km Radius'}]."
    ),

  // Route planning mode (auto-detected when origin and destination provided)
  origin: originCoordinateSchema
    .optional()
    .describe(
      "Origin point for route planning. When provided with destination, triggers automatic route calculation with turn-by-turn navigation. Can include optional 'label' field. DEFAULT label: 'Start'. EXAMPLE: {lat: 52.3676, lon: 4.9041, label: 'Amsterdam Central'}."
    ),

  destination: destinationCoordinateSchema
    .optional()
    .describe(
      "Destination point for route planning. When provided with origin, triggers automatic route calculation with turn-by-turn navigation. Can include optional 'label' field. DEFAULT label: 'End'. EXAMPLE: {lat: 52.36, lon: 4.8852, label: 'Rijksmuseum'}."
    ),

  waypoints: z
    .array(waypointCoordinateSchema)
    .optional()
    .describe(
      "Optional waypoints for route planning when using origin and destination. Each can include optional 'label' field. DEFAULT labels: 'Waypoint 1', 'Waypoint 2', etc. EXAMPLE: [{lat: 52.3745, lon: 4.8979, label: 'Anne Frank House'}]."
    ),

  // Display options
  showLabels: z
    .boolean()
    .optional()
    .describe(
      "Whether to show text labels on markers, routes, and polygons. DEFAULT: false. EXAMPLE: true to display all labels."
    ),

  routeLabel: z
    .string()
    .optional()
    .describe(
      "Custom label for routes when using origin/destination. Used when showLabels=true. EXAMPLE: 'Scenic Route' or 'Fastest Path'."
    ),

  routeInfoDetail: z
    .enum(["basic", "compact", "detailed", "distance-time"])
    .optional()
    .describe(
      "Level of route information to display when using origin/destination. OPTIONS: 'basic' (simple), 'compact' (short), 'detailed' (full), 'distance-time' (time/distance only). DEFAULT: 'basic'. EXAMPLE: 'distance-time' to show just the travel distance and time."
    ),

  // Image response detail level
  detail: z
    .enum(["compact", "full"])
    .optional()
    .default("compact")
    .describe(
      "Controls the image quality included in the tool response. " +
        "'compact' (DEFAULT): Compresses the image to stay under 1MB, using JPEG conversion and/or downscaling as needed. Best for most use cases since the interactive MCP app widget renders the full map separately. " +
        "'full': Returns the original full-resolution PNG image. Use when you need maximum image quality in the conversation, but note this may exceed the 1MB response limit for large/detailed maps."
    ),

  // MCP App visualization control
  show_ui: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Enable interactive MCP app visualization. When true, the response includes a viz_id that allows an MCP App to render an interactive version of the map with zoom, pan, and click capabilities. Set to false if you only need the static PNG image. DEFAULT: false."
    ),
};
