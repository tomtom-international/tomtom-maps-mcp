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
import { avoidableTypes } from "@tomtom-org/maps-sdk/core";
import { uiVisibilityParam } from "../shared/responseOptions";
import { coordinateSchema, routingOptionsSchema, sectionTypeSchema, vehicleSchema } from "./common";

export const tomtomRoutingSchema = {
  locations: z
    .array(coordinateSchema)
    .min(2)
    .describe(
      "Ordered list of coordinates [origin, ...intermediateStops, destination]. Minimum 2 (origin + destination); add intermediate positions for multi-stop routes. Use geocoding for accurate coordinates."
    ),
  ...uiVisibilityParam,
  ...routingOptionsSchema,
  ...vehicleSchema,
  sectionType: sectionTypeSchema,
  vehicleHeading: z
    .number()
    .min(0)
    .max(359)
    .optional()
    .describe(
      "Heading of the vehicle at the origin, in degrees clockwise from north (0-359), for a route that starts in the direction of travel."
    ),
};

export const tomtomReachableRangeSchema = {
  origin: coordinateSchema.describe(
    "Starting point for reachable area calculation. Typically current location or point of interest."
  ),
  ...uiVisibilityParam,
  response_detail: routingOptionsSchema.response_detail.describe(
    "Response detail level. 'compact' (default): no boundary coordinates. 'geometry': compact plus a 'geometry' key holding the boundary as a GeoJSON Polygon with its budget ([lon, lat], at most 1,000 vertices); use this to plot or process the boundary yourself. 'full': the raw API response, lossless and many times larger."
  ),
  // Budget parameters — EXACTLY ONE must be provided, do NOT combine multiple budget types
  timeBudgetInSec: z
    .number()
    .optional()
    .describe(
      "Maximum travel time in seconds. Examples: 900 (15min), 1800 (30min), 3600 (1h). Use ONLY ONE budget parameter — do not combine with other budget types."
    ),
  distanceBudgetInMeters: z
    .number()
    .optional()
    .describe(
      "Maximum travel distance in meters. Examples: 5000 (5km), 10000 (10km), 20000 (20km). Use ONLY ONE budget parameter — do not combine with other budget types."
    ),
  // Basic options
  travelMode: z
    .enum(["car"])
    .optional()
    .describe(
      "Travel mode affects reachable area shape. Default: 'car'. Note: only 'car' is supported for reachable range."
    ),
  routeType: routingOptionsSchema.routeType,
  traffic: routingOptionsSchema.traffic,
  avoid: z
    .array(z.enum(avoidableTypes).exclude(["alreadyUsedRoads"]))
    .optional()
    .describe("Road features to avoid. May shrink the range."),
  departAt: z
    .string()
    .optional()
    .describe("Departure time in ISO format (e.g., '2025-06-24T14:30:00Z')."),
  ...vehicleSchema,
};

export type RoutingParams = z.input<z.ZodObject<typeof tomtomRoutingSchema>>;
export type ReachableRangeParams = z.input<z.ZodObject<typeof tomtomReachableRangeSchema>>;
