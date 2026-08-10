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

import type { Avoidable } from "@tomtom-org/maps-sdk/core";

/**
 * Options for calculating reachable range with the TomTom Maps API
 */
export interface ReachableRangeOptions {
  // Budget parameters (at least one is required)
  timeBudgetInSec?: number; // Time budget in seconds (mapped to SDK timeMinutes)
  distanceBudgetInMeters?: number; // Distance budget in meters (mapped to SDK distanceKM)
  energyBudgetInkWh?: number; // Energy budget in kWh for EV (converted to spentChargePCT using maxChargeInkWh)
  fuelBudgetInLiters?: number; // Fuel budget in liters (mapped to SDK spentFuelLiters)
  chargeBudgetPercent?: number; // Battery % to spend for EV (mapped to SDK spentChargePCT)
  remainingChargeBudgetPercent?: number; // Min remaining battery % for EV (mapped to SDK remainingChargeCPT)

  // Basic routing options
  travelMode?: "car"; // Travel mode (car only)
  routeType?: "fast" | "short" | "efficient" | "thrilling"; // Route type (fast, short, efficient, thrilling)
  traffic?: "live" | "historical"; // Consider traffic conditions
  avoid?: Avoidable | Avoidable[]; // Features to avoid (tollRoads, motorways, etc.)
  departAt?: string; // Departure time (ISO format)
  report?: string; // Report type (effectiveSettings)

  // Route preferences
  hilliness?: "low" | "normal" | "high"; // Hilliness preference
  windingness?: "low" | "normal" | "high"; // Windingness preference

  // Vehicle specifications
  vehicleMaxSpeed?: number; // Max speed in km/h
  vehicleWeight?: number; // Weight in kg

  // Vehicle engine type and parameters
  vehicleEngineType?: "combustion" | "electric"; // Engine type

  // Combustion engine parameters
  constantSpeedConsumptionInLitersPerHundredkm?: string; // Speed-consumption mapping
  currentFuelInLiters?: number; // Current fuel level
  auxiliaryPowerInLitersPerHour?: number; // Aux power consumption
  fuelEnergyDensityInMJoulesPerLiter?: number; // Fuel energy density

  // Electric vehicle parameters
  constantSpeedConsumptionInkWhPerHundredkm?: string; // Speed-consumption mapping
  currentChargeInkWh?: number; // Current battery charge
  maxChargeInkWh?: number; // Maximum battery capacity
  auxiliaryPowerInkW?: number; // Aux power consumption

  // Efficiency parameters
  accelerationEfficiency?: number; // Acceleration efficiency (0-1)
  decelerationEfficiency?: number; // Deceleration efficiency (0-1)
  uphillEfficiency?: number; // Uphill efficiency (0-1)
  downhillEfficiency?: number; // Downhill efficiency (0-1)
  consumptionInkWhPerkmAltitudeGain?: number; // Consumption per km altitude gain
  recuperationInkWhPerkmAltitudeLoss?: number; // Energy recovered per km altitude loss

  // Other options
  callback?: string; // For JSONP callback
}
