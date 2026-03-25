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
 * Schema for Geometry/Area Search tool.
 * Uses TomTom Maps SDK geometrySearch() to find POIs within
 * geometric areas (circles, polygons, or bounding boxes).
 */

import { z } from "zod";
import { responseDetailSchema } from "../shared/responseOptions";
import { uiVisibilityParam } from "./commonOrbis";

export const tomtomAreaSearchSchema = {
  query: z
    .string()
    .describe(
      "What to search for in the area. Examples: 'restaurant', 'hotel', 'parking', 'pharmacy', 'ATM'."
    ),

  // Circle geometry (most common)
  center: z
    .tuple([z.number(), z.number()])
    .optional()
    .describe(
      "Center position as [longitude, latitude] for circular area search (GeoJSON convention). Use with radius. " +
        "Example: [4.89707, 52.377956] for Amsterdam."
    ),

  radius: z
    .number()
    .optional()
    .describe(
      "Radius in meters for circular area search. Required with center. Examples: 500, 1000, 5000."
    ),

  // Polygon geometry (advanced)
  polygon: z
    .array(z.array(z.number()).length(2))
    .optional()
    .describe(
      "Polygon vertices as [[longitude, latitude], ...] (GeoJSON convention). Minimum 3 points, automatically closed. " +
        "Use instead of center/radius for irregular areas."
    ),

  // Bounding box (simple rectangle)
  boundingBox: z
    .array(z.array(z.number()).length(2)).length(2)
    .optional()
    .describe(
      "Rectangular bounding box as [[topLeftLon, topLeftLat], [bottomRightLon, bottomRightLat]] (GeoJSON convention). " +
        "Use instead of center/radius or polygon. Example: [[4.8, 52.45], [4.95, 52.3]] for Amsterdam area."
    ),

  limit: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum number of results (1-100). Default: 10."),

  poiCategories: z
    .array(z.string())
    .optional()
    .describe(
      "Filter POI results by UPPER_SNAKE_CASE text category codes (e.g. 'RESTAURANT', 'PARKING_GARAGE'), NOT numeric IDs. IMPORTANT: Never guess codes — always call tomtom-poi-categories first with the user's intent as keywords to discover valid codes."
    ),

  language: z
    .string()
    .optional()
    .describe("Language for results (IETF tag). Examples: 'en-US', 'de-DE'."),

  countries: z
    .array(z.string())
    .optional()
    .describe("Limit results to countries (ISO alpha-2 codes). Example: ['US'], ['DE', 'FR']."),

  ...uiVisibilityParam,
  response_detail: responseDetailSchema,
};
