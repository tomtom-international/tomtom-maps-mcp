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
    .object({
      lat: z.number().describe("Center latitude of the search area."),
      lon: z.number().describe("Center longitude of the search area."),
    })
    .optional()
    .describe("Center point for circular area search. Use with radius."),

  radius: z
    .number()
    .optional()
    .describe(
      "Radius in meters for circular area search. Required with center. Examples: 500, 1000, 5000."
    ),

  // Polygon geometry (advanced)
  polygon: z
    .array(
      z.object({
        lat: z.number().describe("Latitude of polygon vertex."),
        lon: z.number().describe("Longitude of polygon vertex."),
      })
    )
    .optional()
    .describe(
      "Polygon vertices defining a custom search area. Minimum 3 points. The polygon is automatically closed. Use instead of center/radius for irregular areas."
    ),

  // Bounding box (simple rectangle)
  boundingBox: z
    .object({
      topLeft: z.object({
        lat: z.number().describe("Top-left latitude."),
        lon: z.number().describe("Top-left longitude."),
      }),
      bottomRight: z.object({
        lat: z.number().describe("Bottom-right latitude."),
        lon: z.number().describe("Bottom-right longitude."),
      }),
    })
    .optional()
    .describe("Rectangular bounding box for area search. Use instead of center/radius or polygon."),

  limit: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum number of results (1-100). Default: 10."),

  categorySet: z
    .string()
    .optional()
    .describe(
      "Filter by POI category IDs. Examples: '7315' (Restaurant), '7311' (Gas Station), '7309' (EV Charging), '7314' (Hotel), '9361' (Shop)."
    ),

  language: z
    .string()
    .optional()
    .describe("Language for results (IETF tag). Examples: 'en-US', 'de-DE'."),

  countrySet: z
    .string()
    .optional()
    .describe("Limit results to countries (ISO codes). Examples: 'US', 'DE,FR'."),

  ...uiVisibilityParam,
  response_detail: responseDetailSchema,
};
