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

export const tomtomSearchAlongRouteSchema = {
  origin: z
    .array(z.number())
    .length(2)
    .describe(
      "Route starting point as [longitude, latitude] (GeoJSON convention). " +
        "Use precise coordinates from geocoding. Example: [4.89707, 52.377956]."
    ),

  destination: z
    .array(z.number())
    .length(2)
    .describe(
      "Route ending point as [longitude, latitude] (GeoJSON convention). " +
        "Use precise coordinates from geocoding. Example: [13.404954, 52.520008]."
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

  routeType: z
    .enum(["fast", "short", "efficient"])
    .optional()
    .describe("Route optimization for the base route. Default: 'fast'."),

  ...uiVisibilityParam,
  response_detail: responseDetailSchema,
};
