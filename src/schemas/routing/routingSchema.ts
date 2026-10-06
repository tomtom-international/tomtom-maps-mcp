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
import { geometryResponseDetailSchema, uiVisibilityParam } from "../shared/responseOptions";
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
  // The Routing API ignores the current fuel and charge for a route
  ...z.object(vehicleSchema).omit({ currentFuelInLiters: true, currentChargeInkWh: true }).shape,
  maxChargeInkWh: vehicleSchema.maxChargeInkWh.describe(
    "EV battery capacity in kWh. Adds the battery consumption as a percentage (batteryConsumptionInPCT) to the route summary."
  ),
  sectionType: sectionTypeSchema.describe(
    "Road section types to return in the route, e.g. toll (toll roads), urban (city areas), country (rural areas)."
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
      "Battery charging curve: the maximum charging power up to each battery level. Without it a generic curve is used (200 kW up to 50 kWh, 100 kW up to 70 kWh, 40 kW up to 80 kWh)."
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
  routeType: routingOptionsSchema.routeType,

  traffic: z
    .enum(["live", "historical"])
    .optional()
    .describe("Traffic consideration: 'live' (real-time), 'historical' (patterns only)."),

  avoid: routingOptionsSchema.avoid,

  departAt: z
    .string()
    .optional()
    .describe("Departure time in ISO format (e.g., '2025-06-24T14:30:00Z')."),

  ...uiVisibilityParam,
  response_detail: geometryResponseDetailSchema,
};

export type RoutingParams = z.input<z.ZodObject<typeof tomtomRoutingSchema>>;
export type ReachableRangeParams = z.input<z.ZodObject<typeof tomtomReachableRangeSchema>>;
export type EvRoutingParams = z.input<z.ZodObject<typeof tomtomEvRoutingSchema>>;
