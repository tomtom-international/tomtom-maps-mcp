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
import { avoidableTypes, inputSectionTypes } from "@tomtom-org/maps-sdk/core";
import { routeTypes } from "@tomtom-org/maps-sdk/services";
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
};

export const vehicleSchema = {
  vehicleMaxSpeed: z
    .number()
    .optional()
    .describe("Maximum vehicle speed in km/h for commercial routing."),

  vehicleWeight: z
    .number()
    .optional()
    .describe("Vehicle weight in kg. Required by the efficiency parameters."),

  vehicleEngineType: z
    .enum(["combustion", "electric"])
    .optional()
    .describe(
      "Engine type. Required with any consumption, charge, fuel or efficiency parameter: 'electric' for the kWh parameters, 'combustion' for the liter and fuel parameters."
    ),

  currentChargeInkWh: z.number().optional().describe("Current EV battery charge in kWh."),

  maxChargeInkWh: z.number().optional().describe("Maximum EV battery capacity in kWh."),

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

  constantSpeedConsumptionInLitersPerHundredkm: z
    .string()
    .optional()
    .describe(
      "Combustion speed-to-consumption mappings format: '50,6.5:130,11.5' (speed in km/h, consumption in L/100km). Required for combustion engine fuel budget calculations."
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
    .describe(
      "Fuel energy density in megajoules per liter. Combustion only; required with, and only used with, the efficiency parameters."
    ),

  accelerationEfficiency: z
    .number()
    .optional()
    .describe(
      "Efficiency during acceleration (0-1). Requires decelerationEfficiency and vehicleWeight, and fuelEnergyDensityInMJoulesPerLiter for combustion."
    ),

  decelerationEfficiency: z
    .number()
    .optional()
    .describe(
      "Efficiency during deceleration (0-1). Requires accelerationEfficiency and vehicleWeight, and fuelEnergyDensityInMJoulesPerLiter for combustion."
    ),

  uphillEfficiency: z
    .number()
    .optional()
    .describe(
      "Efficiency during uphill driving (0-1). Requires downhillEfficiency and vehicleWeight, and fuelEnergyDensityInMJoulesPerLiter for combustion."
    ),

  downhillEfficiency: z
    .number()
    .optional()
    .describe(
      "Efficiency during downhill driving (0-1). Requires uphillEfficiency and vehicleWeight, and fuelEnergyDensityInMJoulesPerLiter for combustion."
    ),

  consumptionInkWhPerkmAltitudeGain: z
    .number()
    .optional()
    .describe(
      "EV energy in kWh used per 1,000 m of elevation gained. Give it with recuperationInkWhPerkmAltitudeLoss and the EV consumption curve; not with the efficiency parameters."
    ),

  recuperationInkWhPerkmAltitudeLoss: z
    .number()
    .optional()
    .describe(
      "EV energy in kWh recovered per 1,000 m of elevation lost, at most consumptionInkWhPerkmAltitudeGain. Give it with consumptionInkWhPerkmAltitudeGain and the EV consumption curve; not with the efficiency parameters."
    ),
};

export const sectionTypeSchema = z.array(z.enum(inputSectionTypes)).optional();
