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
import {
  coordinateSchema,
  routingOptionsSchema,
  vehicleSchema,
  sectionTypeSchema,
  uiVisibilityParam,
} from "./commonOrbis";
import { responseDetailSchema } from "../shared/responseOptions";

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
  sectionType: sectionTypeSchema.describe(
    "Highlight specific road section types in response for route analysis: toll (toll roads), motorway (highways), tunnel, urban (city areas), country (rural areas), pedestrian (walking paths), etc."
  ),
};

export const tomtomReachableRangeSchema = {
  origin: coordinateSchema.describe(
    "Starting point for reachable area calculation. Typically current location or point of interest."
  ),
  ...uiVisibilityParam,
  response_detail: routingOptionsSchema.response_detail.describe(
    "Response detail level. 'compact' (default): returns center point only, boundary coordinates are trimmed — the MCP App still renders the full reachable range polygon. 'full': includes boundary coordinates in the response, use this when you need to plot or process the boundary data yourself."
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
  chargeBudgetPercent: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe(
      "Battery percentage to spend for electric vehicles (0–100). Example: 80 means use 80% of battery. REQUIRED companions: vehicleEngineType='electric', constantSpeedConsumptionInkWhPerHundredkm, currentChargeInkWh, maxChargeInkWh. Use ONLY ONE budget parameter — do not combine with other budget types."
    ),
  remainingChargeBudgetPercent: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe(
      "Minimum remaining battery percentage for electric vehicles (0–100). Example: 20 means keep at least 20% charge. REQUIRED companions: vehicleEngineType='electric', constantSpeedConsumptionInkWhPerHundredkm, currentChargeInkWh, maxChargeInkWh. Use ONLY ONE budget parameter — do not combine with other budget types."
    ),
  energyBudgetInkWh: z
    .number()
    .optional()
    .describe(
      "Energy budget in kWh for electric vehicles. Example: 20 means use 20 kWh. REQUIRED companions: vehicleEngineType='electric', constantSpeedConsumptionInkWhPerHundredkm, currentChargeInkWh, maxChargeInkWh. Use ONLY ONE budget parameter — do not combine with other budget types."
    ),
  fuelBudgetInLiters: z
    .number()
    .optional()
    .describe(
      "Maximum fuel budget in liters for combustion vehicles. Example: 5 (5 liters). REQUIRED companions: vehicleEngineType='combustion' and constantSpeedConsumptionInLitersPerHundredkm (e.g. '50,6.5:130,11.5'). Use ONLY ONE budget parameter — do not combine with other budget types."
    ),
  // Basic options
  travelMode: z
    .enum(["car"])
    .optional()
    .describe(
      "Travel mode affects reachable area shape. Default: 'car'. Note: TomTom Orbis Maps API only supports 'car' for reachable range."
    ),
  routeType: z
    .enum(["fast", "short", "efficient", "thrilling"])
    .optional()
    .describe(
      "Route optimization: 'fast' (time-optimized), 'short' (distance-optimized), 'efficient' (fuel-efficient), 'thrilling' (scenic)."
    ),
  traffic: z
    .enum(["live", "historical"])
    .optional()
    .describe(
      "Traffic consideration: 'live' (real-time + historical), 'historical' (historical only)."
    ),
  avoid: z
    .array(z.string())
    .optional()
    .describe(
      "Route features to avoid. May increase travel time. Options: 'tollRoads','motorways','ferries','unpavedRoads','carpools','alreadyUsedRoads'. Accepts array of string(s)."
    ),
  departAt: z
    .string()
    .optional()
    .describe("Departure time in ISO format (e.g., '2025-06-24T14:30:00Z')."),
  report: z
    .string()
    .optional()
    .describe(
      "Specifies which data should be reported for diagnostic purposes. A possible value is: effectiveSettings. Reports the effective parameters or data used when calling the API. In the case of defaulted parameters, the default will be reflected where the parameter was not specified by the caller."
    ),
  windingness: z
    .enum(["low", "normal", "high"])
    .optional()
    .describe(
      "Preference for avoiding winding roads. Use 'low' for straighter routes. This can be only used when `routeType` parameter is set to `thrilling`."
    ),
  hilliness: z
    .enum(["low", "normal", "high"])
    .optional()
    .describe(
      "Preference for avoiding hills. Use 'low' for flatter routes. This can be only used when `routeType` parameter is set to `thrilling`."
    ),
  ...vehicleSchema,
};

// ---------------------------------------------------------------------------
// Long Distance EV Routing
// ---------------------------------------------------------------------------

export const tomtomEvRoutingSchema = {
  origin: coordinateSchema.describe(
    "Starting point coordinates. Use precise coordinates from geocoding."
  ),

  destination: coordinateSchema.describe(
    "Destination coordinates. Use precise coordinates from geocoding."
  ),

  waypoints: z
    .array(coordinateSchema)
    .optional()
    .describe("Optional intermediate waypoints the route should pass through."),

  // EV Battery State
  currentChargePercent: z
    .number()
    .min(0)
    .max(100)
    .describe("Current battery charge as percentage (0-100). Example: 80 means 80% charged."),

  // EV Model Parameters
  maxChargeKWH: z
    .number()
    .describe(
      "Maximum battery capacity in kWh. Examples: 40 (Nissan Leaf), 75 (Tesla Model 3 LR), 100 (Tesla Model S)."
    ),

  consumptionInKWH: z
    .array(
      z.object({
        speedKMH: z.number().describe("Speed in km/h."),
        consumptionUnitsPer100KM: z
          .number()
          .describe("Energy consumption in kWh per 100km at this speed."),
      })
    )
    .optional()
    .describe(
      "Speed-to-consumption mapping for energy modeling. Example: [{speedKMH:50,consumptionUnitsPer100KM:12},{speedKMH:100,consumptionUnitsPer100KM:18}]. Uses reasonable defaults if not provided."
    ),

  batteryCurve: z
    .array(
      z.object({
        stateOfChargeInkWh: z.number().describe("Battery level in kWh at this point on the curve."),
        maxPowerInkW: z.number().describe("Maximum charging power in kW at this battery level."),
      })
    )
    .optional()
    .describe(
      "Battery charging curve defining max charging power at various charge levels. Optional — SDK uses defaults if not provided."
    ),

  // Charging Preferences
  minChargeAtDestinationPercent: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .default(20)
    .describe(
      "Minimum battery percentage to arrive at destination with. Default: 20%. Higher = more safety buffer."
    ),

  minChargeAtChargingStopsPercent: z
    .number()
    .min(0)
    .max(50)
    .optional()
    .default(10)
    .describe("Minimum battery percentage to arrive at each charging stop with. Default: 10%."),

  // Route Options
  routeType: z
    .enum(["fast", "short", "efficient"])
    .optional()
    .describe(
      "Route optimization: 'fast' (time), 'short' (distance), 'efficient' (energy). Default: 'fast'."
    ),

  traffic: z
    .enum(["live", "historical"])
    .optional()
    .describe("Traffic consideration: 'live' (real-time), 'historical' (patterns only)."),

  avoid: z
    .array(z.string())
    .optional()
    .describe(
      "Route features to avoid: 'tollRoads', 'motorways', 'ferries', 'unpavedRoads'. Accepts array of string(s)."
    ),

  departAt: z
    .string()
    .optional()
    .describe("Departure time in ISO format (e.g., '2025-06-24T14:30:00Z')."),

  ...uiVisibilityParam,
  response_detail: responseDetailSchema,
};

export type RoutingOrbisParams = z.input<z.ZodObject<typeof tomtomRoutingSchema>>;
export type ReachableRangeOrbisParams = z.input<z.ZodObject<typeof tomtomReachableRangeSchema>>;
export type EvRoutingOrbisParams = z.input<z.ZodObject<typeof tomtomEvRoutingSchema>>;
