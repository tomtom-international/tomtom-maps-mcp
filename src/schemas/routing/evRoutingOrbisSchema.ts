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
 * Schema for Long Distance EV Routing tool.
 * Uses TomTom Maps SDK calculateRoute() with electric vehicle parameters.
 *
 * SDK function: calculateRoute({ locations, vehicle: { engineType: 'electric', ... }, ... })
 */

import { z } from "zod";
import { responseDetailSchema } from "../shared/responseOptions";
import { uiVisibilityParam, coordinateSchema } from "./commonOrbis";

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
