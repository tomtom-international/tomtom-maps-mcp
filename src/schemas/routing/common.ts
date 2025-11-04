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

// Common coordinate schema for reuse
export const originCoordinateSchema = z.object({
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

export const destinationCoordinateSchema = z.object({
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
    .enum(["fastest", "shortest", "eco", "thrilling"])
    .optional()
    .describe(
      "Route optimization: 'fastest' (time-optimized), 'shortest' (distance-optimized), 'eco' (fuel-efficient), 'thrilling' (scenic)."
    ),

  travelMode: z
    .enum(["car", "pedestrian", "bicycle", "truck", "taxi", "bus", "van"])
    .optional()
    .describe("Transportation mode. Default: 'car'."),

  traffic: z
    .boolean()
    .optional()
    .describe("Include real-time traffic data for more accurate ETAs and route suggestions."),

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

  instructionsType: z
    .enum(["coded", "text", "tagged"])
    .optional()
    .describe(
      "Instruction format: 'text' (human-readable), 'coded' (machine-readable), 'tagged' (HTML)."
    ),

  language: z
    .string()
    .optional()
    .describe("Language code for instructions (e.g., 'en-US', 'de-DE')."),

  computeBestOrder: z
    .boolean()
    .optional()
    .describe(
      "Reorder waypoints for optimization. Use with multiple waypoints to find the most efficient route order."
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

  includeTollPaymentTypes: z
    .string()
    .optional()
    .describe(
      "Include toll payment types in the toll section. If a toll section has different toll payment types in its subsections, this toll section is split into multiple toll sections with the toll payment types. Possible values: all(Include toll payment types in the toll section.), none (Do not include toll payment types in the toll section). The value `all` must be used together with sectionType=toll. Default value: none"
    ),

  report: z
    .string()
    .optional()
    .describe(
      "Specifies which data should be reported for diagnostic purposes. A possible value is: `effectiveSettings`. Reports the effective parameters or data used when calling the API. In the case of defaulted parameters, the default will be reflected where the parameter was not specified by the caller. Default value: effectiveSettings"
    ),

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

  computeTravelTimeFor: z
    .enum(["all", "none"])
    .optional()
    .describe("Calculate travel times for all segments ('all') or none ('none')."),

  hilliness: z
    .enum(["low", "normal", "high"])
    .optional()
    .describe("Preference for avoiding hills. Use 'low' for flatter routes."),

  windingness: z
    .enum(["low", "normal", "high"])
    .optional()
    .describe("Preference for avoiding winding roads. Use 'low' for straighter routes."),
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

  vehicleWidth: z
    .number()
    .optional()
    .describe("Vehicle width in meters. Used to avoid narrow roads."),

  vehicleHeight: z
    .number()
    .optional()
    .describe("Vehicle height in meters. Used to avoid low bridges."),

  vehicleLength: z
    .number()
    .optional()
    .describe("Vehicle length in meters. Affects maneuverability restrictions."),

  vehicleCommercial: z
    .boolean()
    .optional()
    .describe("Commercial vehicle flag. Affects road access restrictions."),

  vehicleAxleWeight: z
    .number()
    .optional()
    .describe("Vehicle axle weight in kg for weight-restricted roads."),

  vehicleNumberOfAxles: z
    .number()
    .optional()
    .describe("Number of axles on the vehicle. Used for toll calculations and restrictions."),

  vehicleLoadType: z.string().optional().describe("Cargo type for hazardous materials routing."),

  vehicleAdrTunnelRestrictionCode: z
    .string()
    .optional()
    .describe("ADR tunnel restriction code for hazardous materials."),

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

  chargeMarginsInkWh: z
    .string()
    .optional()
    .describe("Comma-separated charge margins in kWh for route planning."),

  // Combustion vehicle options
  constantSpeedConsumptionInLitersPerHundredkm: z
    .string()
    .optional()
    .describe(
      "Combustion speed-to-consumption mappings: '50,6.3:130,11.5' (speed in km/h, consumption in L/100km)."
    ),

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
