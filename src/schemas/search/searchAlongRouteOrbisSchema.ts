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
 * Schema for Search Along Route tool.
 * Uses TomTom Maps SDK calculateRoute() to get route geometry,
 * then geometrySearch() to find POIs along the route corridor.
 */

import { z } from "zod";
import { responseDetailSchema } from "../shared/responseOptions";
import { uiVisibilityParam } from "../routing/commonOrbis";

const coordinateSchema = z.object({
  lat: z.number().describe("Latitude coordinate."),
  lon: z.number().describe("Longitude coordinate."),
});

export const tomtomSearchAlongRouteSchema = {
  origin: coordinateSchema.describe(
    "Route starting point. Use precise coordinates from geocoding."
  ),

  destination: coordinateSchema.describe(
    "Route ending point. Use precise coordinates from geocoding."
  ),

  query: z
    .string()
    .describe(
      "What to search for along the route. Examples: 'gas station', 'restaurant', 'coffee', 'hotel', 'EV charging'."
    ),

  corridorWidth: z
    .number()
    .optional()
    .describe(
      "Search corridor width in meters from the route centerline. Default: 5000 (5km). Smaller values = closer to route."
    ),

  limit: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum number of POI results (1-100). Default: 10."),

  categorySet: z
    .string()
    .optional()
    .describe(
      "Filter by POI category IDs. Examples: '7315' (Restaurant), '7311' (Gas Station), '7309' (EV Charging), '7314' (Hotel)."
    ),

  language: z
    .string()
    .optional()
    .describe("Language for results (IETF tag). Examples: 'en-US', 'de-DE'."),

  routeType: z
    .enum(["fast", "short", "efficient"])
    .optional()
    .describe("Route optimization for the base route. Default: 'fast'."),

  ...uiVisibilityParam,
  response_detail: responseDetailSchema,
};
