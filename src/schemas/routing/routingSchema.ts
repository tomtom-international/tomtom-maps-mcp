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
import { originCoordinateSchema, destinationCoordinateSchema, coordinateSchema, routingOptionsSchema, vehicleSchema, sectionTypeSchema } from "./common";

export const tomtomRoutingSchema = {
  origin: originCoordinateSchema.describe(
    "Starting point coordinates. Obtain from geocoding for best results."
  ),
  destination: destinationCoordinateSchema.describe(
    "Destination coordinates. Obtain from geocoding for best results."
  ),
  ...routingOptionsSchema,
  ...vehicleSchema,
  sectionType: sectionTypeSchema.describe(
    "Highlight specific road section types in response for route analysis: toll (toll roads), motorway (highways), tunnel, urban (city areas), country (rural areas), pedestrian (walking paths), etc."
  ),
};

export const tomtomWaypointRoutingSchema = {
  waypoints: z
    .array(coordinateSchema)
    .min(2)
    .describe(
      "Ordered array of waypoint coordinates (minimum 2). Route calculated in exact sequence provided. Use geocoding for accurate coordinates."
    ),
  ...routingOptionsSchema,
  ...vehicleSchema,
  sectionType: sectionTypeSchema.describe(
    "Road section types to highlight for route analysis. Options: toll (toll roads), motorway (highways), tunnel, urban (city areas), country (rural areas), pedestrian (walking paths), traffic (traffic incidents), toll_road, ferry, travel_mode, important_road_stretch. Accepts array of string(s)."
  ),
};

export const tomtomReachableRangeSchema = {
  origin: coordinateSchema.describe(
    "Starting point for reachable area calculation. Typically current location or point of interest."
  ),
  // Budget parameters
  timeBudgetInSec: z
    .number()
    .optional()
    .describe(
      "Maximum travel time in seconds. Examples: 900 (15min), 1800 (30min), 3600 (1h). Either time or distance budget required."
    ),
  distanceBudgetInMeters: z
    .number()
    .optional()
    .describe(
      "Maximum travel distance in meters. Examples: 5000 (5km), 10000 (10km), 20000 (20km). Either time or distance budget required."
    ),
  energyBudgetInkWh: z
    .number()
    .optional()
    .describe("Maximum energy budget in kWh for electric vehicles. Example: 10 (10 kWh)."),
  fuelBudgetInLiters: z
    .number()
    .optional()
    .describe("Maximum fuel budget in liters for combustion vehicles. Example: 5 (5 liters)."),
  // Basic options
  travelMode: z
    .enum(["car", "truck"])
    .optional()
    .describe(
      "Travel mode affects reachable area shape. Default: 'car'. Note: Pedestrian/bicycle modes not supported by API."
    ),
  routeType: z
    .enum(["fastest", "shortest", "eco", "thrilling"])
    .optional()
    .describe(
      "Route optimization: 'fastest' (time-optimized), 'shortest' (distance-optimized), 'eco' (fuel-efficient)."
    ),
  traffic: z
    .boolean()
    .optional()
    .describe("Include real-time traffic data for more accurate reachable area calculation."),
  avoid: z
    .array(z.string())
    .optional()
    .describe(
      "Route features to avoid. May increase travel time. Options: 'tollRoads','motorways','ferries','unpavedRoads','carpools','alreadyUsedRoads'. Accepts array of string(s)."
    ),
  maxFerryLengthInMeters: z.number().optional().describe("Maximum allowed ferry length in meters."),
  departAt: z
    .string()
    .optional()
    .describe("Departure time in ISO format (e.g., '2025-06-24T14:30:00Z')."),
  report: z
    .string()
    .optional()
    .describe(
      "Specifies which data should be reported for diagnostic purposes. A possible value is: effectiveSettings. Reports the effective parameters or data used when calling the API. In the case of defaulted parameters, the default will be reflected where the parameter was not specified by the caller. Default value: effectiveSettings"
    ),
  hilliness: z
    .enum(["low", "normal", "high"])
    .optional()
    .describe(
      "Preference for avoiding hills. Use 'low' for flatter routes. This can be only used when `routeType` parameter is set to `thrilling`."
    ),
  windingness: z
    .enum(["low", "normal", "high"])
    .optional()
    .describe(
      "Preference for avoiding winding roads. Use 'low' for straighter routes. This can be only used when `routeType` parameter is set to `thrilling`."
    ),
  ...vehicleSchema,
};
