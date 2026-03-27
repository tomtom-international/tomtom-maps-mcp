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
// Common coordinate schema for reuse
export const coordinateSchema = z.object({
  lat: z
    .number()
    .describe(
      "Latitude coordinate (-90 to +90). Use precise coordinates from geocoding for best results."
    ),
  lon: z
    .number()
    .describe(
      "Longitude coordinate (-180 to +180). Use precise coordinates from geocoding for best results."
    ),
});
export const tomtomMapSchema = {
  center: coordinateSchema.describe(
    "Map center coordinates. Use results from geocoding or search operations for best positioning."
  ),

  // Fix: Use z.array() instead of z.tuple()
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
      "Zoom level (0-22). Examples: 3 (continent), 6 (country), 10 (city), 15 (neighborhood), 18 (street). Default: 15."
    ),

  width: z
    .number()
    .min(50)
    .max(2048)
    .optional()
    .describe(
      "Map width in pixels (50-2048). Examples: 300-500 (preview), 800-1200 (detailed). Default: 512."
    ),

  height: z
    .number()
    .min(50)
    .max(2048)
    .optional()
    .describe(
      "Map height in pixels (50-2048). Examples: 300-500 (preview), 800-1200 (detailed). Default: 512."
    ),

  style: z
    .enum(["main", "night"])
    .optional()
    .describe("Map style: 'main' (default daytime), 'night' (dark theme)."),

  layer: z
    .enum(["basic", "labels", "hybrid"])
    .optional()
    .describe(
      "Map layer type: 'basic' (streets), 'labels' (text only, transparent background), 'hybrid' (satellite with labels)."
    ),

  format: z
    .enum(["png", "jpg"])
    .optional()
    .describe(
      "Image format: 'png' (better quality, supports transparency), 'jpg' (smaller file size)."
    ),

  view: z
    .enum(["Unified", "IL", "IN", "MA", "PK", "AR", "Arabic", "RU", "TR", "CN", "US"])
    .optional()
    .describe(
      "Geopolitical view for border disputes and territories. 'Unified' is the international standard view."
    ),

  language: z
    .string()
    .optional()
    .describe("Language for map labels (IETF language tag). Examples: 'en-US', 'es-ES', 'fr-FR'."),
};

export type MapParams = z.input<z.ZodObject<typeof tomtomMapSchema>>;
