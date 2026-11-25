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

import { avoidableTypes } from "@tomtom-org/maps-sdk/core";
import { routeTypes } from "@tomtom-org/maps-sdk/services";
import { z } from "zod";
import { geometryResponseDetailSchema } from "../shared/responseOptions";

export const coordinateSchema = z
  .array(z.number())
  .length(2)
  .describe(
    "Position as [longitude, latitude] (GeoJSON convention, lng first). " +
      "Example: [4.89707, 52.377956] for Amsterdam, [13.404954, 52.520008] for Berlin."
  );

export const routingOptionsSchema = {
  response_detail: geometryResponseDetailSchema,

  routeType: z
    .enum(routeTypes)
    .optional()
    .describe(
      "Route optimization: 'fast' (time-optimized), 'short' (distance-optimized), 'efficient' (fuel-efficient), 'thrilling' (scenic). Default: 'fast'."
    ),

  travelMode: z.enum(["car"]).optional().describe("Transportation mode. Default: 'car'."),

  traffic: z
    .enum(["live", "historical"])
    .optional()
    .describe(
      "Traffic consideration: 'live' (real-time + historical), 'historical' (historical only)."
    ),

  avoid: z
    .array(z.enum(avoidableTypes))
    .optional()
    .describe("Route features to avoid. May increase travel time."),

  departAt: z
    .string()
    .optional()
    .describe(
      "Departure time, ISO 8601. Without an offset ('2025-06-24T08:15:00') it is the local time " +
        "at the origin, so pass a stated local time that way; with one ('2025-06-24T14:30:00Z') " +
        "it is that instant. Cannot be used with arriveAt."
    ),

  arriveAt: z
    .string()
    .optional()
    .describe(
      "Arrival time, ISO 8601. Without an offset it is the local time at the destination; with " +
        "one it is that instant. Cannot be used with departAt."
    ),

  maxAlternatives: z
    .number()
    .optional()
    .describe(
      "Number of alternative routes (0-5). Each alternative is compared with the first route: " +
        "its extra time and distance, the roads only it takes, the tolls, ferries and traffic " +
        "it adds or avoids, and, with `curves`, the curves."
    ),
};
