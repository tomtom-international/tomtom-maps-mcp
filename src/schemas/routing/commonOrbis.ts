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

// Common coordinate schema for reuse
export const coordinateSchema = z.object({
  lat: z
    .number()
    .describe(
      "Latitude coordinate (-90 to +90). Use precise coordinates from geocoding for best results."
    ),
  lon: z
    .number()
    .describe(
      "Longitude coordinate (-180 to +180). Use precise coordinates from geocoding for best results."
    ),
});

// Common routing options schema for reuse
export const routingOptionsSchema = {
  routeType: z
    .enum(["fast", "short", "efficient", "thrilling"])
    .optional()
    .describe(
      "Route optimization: 'fast' (time-optimized), 'short' (distance-optimized), 'efficient' (fuel-efficient), 'thrilling' (scenic)."
    ),

  travelMode: z.enum(["car"]).optional().describe("Transportation mode. Default: 'car'."),

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
    .describe(
      "Departure time in ISO format (e.g., '2025-06-24T14:30:00Z'). Cannot be used with arriveAt."
    ),

  arriveAt: z
    .string()
    .optional()
    .describe(
      "Arrival time in ISO format (e.g., '2025-06-24T17:00:00Z'). Cannot be used with departAt."
    ),

  maxAlternatives: z
    .number()
    .optional()
    .describe(
      "Number of alternative routes (0-5). More alternatives = more options but larger response."
    ),

  alternativeType: z
    .enum(["anyRoute", "betterRoute"])
    .optional()
    .describe(
      "When maxAlternatives is greater than 0, it allows the definition of computing alternative routes: finding routes that are significantly different from the reference route, or finding routes that are better than the reference route. Possible values are: `anyRoute` (returns alternative routes that are significantly different from the reference route.), `betterRoute` (only returns alternative routes that are better than the reference route, according to the given planning criteria (set by routeType). If there is a road block on the reference route, then any alternative that does not contain any blockages will be considered a better route. The summary in the route response will contain information (see the planningReason parameter) about the reason for the better alternative.) Note: The betterRoute value can only be used when reconstructing a reference route. Default value: `anyRoute` Other values: `betterRoute`"
    ),

  supportingPoints: z
    .string()
    .optional()
    .describe(
      "Additional coordinates that influence the route shape without being stops (format: 'lat,lon;lat,lon')."
    ),

  vehicleHeading: z
    .number()
    .optional()
    .describe("Heading of the vehicle in degrees (0-359) for more accurate initial routing."),

  routeRepresentation: z
    .enum(["polyline", "summaryOnly", "encodedPolyline", "none"])
    .optional()
    .describe(
      "Representation of routes in response: 'polyline' (default, includes points), 'encodedPolyline' (compressed format), 'summaryOnly' (no points), 'none' (with computeBestOrder only). It cannot be used when `maxAlternatives` is set"
    ),

  extendedRouteRepresentation: z
    .string()
    .optional()
    .describe("Additional routing data formats to include in the response."),

  minDeviationDistance: z
    .number()
    .optional()
    .describe(
      "Minimum distance (meters) alternatives must follow the reference route from origin."
    ),

  minDeviationTime: z
    .number()
    .optional()
    .describe("Minimum time (seconds) alternatives must follow the reference route from origin."),

  supportingPointIndexOfOrigin: z
    .number()
    .optional()
    .describe("Index hint for disambiguating polyline origin point (0 to polyline size - 1)."),

  reconstructionMode: z
    .enum(["track", "route", "update"])
    .optional()
    .describe(
      "How to reconstruct polyline: 'track' (flexible), 'route' (close match), 'update' (ignore restrictions)."
    ),
};

// Vehicle specification schema for commercial routing
export const vehicleSchema = {
  // Basic vehicle properties
  vehicleMaxSpeed: z
    .number()
    .optional()
    .describe("Maximum vehicle speed in km/h for commercial routing."),

  vehicleWeight: z
    .number()
    .optional()
    .describe("Vehicle weight in kg. Important for truck routing restrictions."),

  // Engine type and energy options
  vehicleEngineType: z
    .enum(["combustion", "electric"])
    .optional()
    .describe("Engine type for fuel/energy consumption calculation."),

  // Electric vehicle options
  currentChargeInkWh: z
    .number()
    .optional()
    .describe("Current EV battery charge in kWh. Required for EV routing."),

  maxChargeInkWh: z
    .number()
    .optional()
    .describe("Maximum EV battery capacity in kWh. Required for EV routing."),

  constantSpeedConsumptionInkWhPerHundredkm: z
    .string()
    .optional()
    .describe(
      "EV speed-to-consumption mappings format: '50,8.2:130,21.3' (speed in km/h, consumption in kWh/100km)."
    ),

  auxiliaryPowerInkW: z
    .number()
    .optional()
    .describe("Auxiliary power consumption in kW for electric vehicles."),

  currentFuelInLiters: z
    .number()
    .optional()
    .describe("Current fuel level in liters for combustion vehicles."),

  auxiliaryPowerInLitersPerHour: z
    .number()
    .optional()
    .describe("Auxiliary power consumption for combustion vehicles in L/hr."),

  fuelEnergyDensityInMJoulesPerLiter: z
    .number()
    .optional()
    .describe("Fuel energy density in megajoules per liter."),

  vehicleHasElectricTollCollectionTransponder: z
    .enum(["all", "none"])
    .optional()
    .describe(
      "ETC transponder availability: 'all' (has transponder), 'none' (avoid ETC-only roads)."
    ),

  arrivalSidePreference: z
    .enum(["anySide", "curbSide"])
    .optional()
    .describe("Preferred arrival side: 'anySide' (either side), 'curbSide' (minimize crossings)."),

  // Efficiency parameters
  accelerationEfficiency: z.number().optional().describe("Efficiency during acceleration (0-1)."),

  decelerationEfficiency: z.number().optional().describe("Efficiency during deceleration (0-1)."),

  uphillEfficiency: z.number().optional().describe("Efficiency during uphill driving (0-1)."),

  downhillEfficiency: z.number().optional().describe("Efficiency during downhill driving (0-1)."),

  consumptionInkWhPerkmAltitudeGain: z
    .number()
    .optional()
    .describe("Energy used per km of altitude gain."),

  recuperationInkWhPerkmAltitudeLoss: z
    .number()
    .optional()
    .describe("Energy recovered per km of altitude loss."),
};
// Section types for routing
export const sectionTypeSchema = z.array(z.string()).optional();
