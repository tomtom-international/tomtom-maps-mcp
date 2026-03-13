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
 * Routing SDK Service
 * Uses TomTom Maps SDK calculateRoute() and calculateReachableRange() directly.
 */

import {
  calculateRoute,
  calculateReachableRange,
  calculateReachableRanges,
  type MaxNumberOfAlternatives,
  type RouteType,
  type TrafficInput,
  type BudgetType,
} from "@tomtom-org/maps-sdk/services";
import { type Routes, type Avoidable, type TravelMode, type Language } from "@tomtom-org/maps-sdk/core";
import type { Position } from "geojson";
import { getEffectiveApiKey } from "../base/tomtomClient";
import { logger } from "../../utils/logger";
import { IncorrectError } from "../../types/types";
import type { ReachableRangeOptionsOrbis } from "./types";

interface RouteOptions {
  routeType?: RouteType;
  traffic?: TrafficInput;
  avoid?: Avoidable | Avoidable[];
  travelMode?: TravelMode;
  departAt?: string;
  arriveAt?: string;
  maxAlternatives?: MaxNumberOfAlternatives;
  language?: Language;
  instructionsType?: string;
}

/**
 * Build SDK CalculateRouteParams from route options
 */
function buildSdkRouteParams(
  locations: Position[],
  options?: RouteOptions
): Record<string, unknown> {
  const params: Record<string, unknown> = { locations };

  // Cost model (routeType, traffic, avoid)
  const costModel: Record<string, unknown> = {};
  if (options?.routeType) costModel.routeType = options.routeType;
  if (options?.traffic) costModel.traffic = options.traffic;
  if (options?.avoid) {
    costModel.avoid = Array.isArray(options.avoid) ? options.avoid : [options.avoid];
  }
  if (Object.keys(costModel).length > 0) params.costModel = costModel;

  // Travel mode
  if (options?.travelMode) params.travelMode = options.travelMode;

  // Departure / arrival time
  if (options?.departAt) {
    params.when = { option: "departAt", date: new Date(options.departAt) };
  } else if (options?.arriveAt) {
    params.when = { option: "arriveBy", date: new Date(options.arriveAt) };
  }

  // Alternative routes
  if (options?.maxAlternatives !== undefined) params.maxAlternatives = options.maxAlternatives;

  // Language
  if (options?.language) params.language = options.language;

  // Guidance / instructions
  if (options?.instructionsType) {
    params.guidance = { type: options.instructionsType };
  }

  return params;
}

/**
 * Calculate a route through an ordered list of locations.
 * @param locations Array of [longitude, latitude] positions (GeoJSON convention)
 *   in the form [origin, ...intermediateStops, destination].
 *   Minimum 2 positions (origin + destination). Add intermediate positions for multi-stop routes.
 */
export async function getRoute(locations: Position[], options?: RouteOptions): Promise<Routes> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error("API key not available");

  if (locations.length < 2) {
    throw new IncorrectError("At least two locations (origin and destination) are required", {
      location_count: locations.length,
      minimum_required: 2,
    });
  }

  logger.debug({ location_count: locations.length }, "Calculating route via SDK");

  const routeParams = buildSdkRouteParams(locations, options);
  routeParams.apiKey = apiKey;

  return calculateRoute(routeParams as Parameters<typeof calculateRoute>[0]);
}

/**
 * Map user-facing budget options to SDK budget object.
 */
function buildBudget(options: ReachableRangeOptionsOrbis): { type: BudgetType; value: number } {
  if (options.timeBudgetInSec !== undefined) {
    return { type: "timeMinutes", value: options.timeBudgetInSec / 60 };
  }
  if (options.distanceBudgetInMeters !== undefined) {
    return { type: "distanceKM", value: options.distanceBudgetInMeters / 1000 };
  }
  if (options.fuelBudgetInLiters !== undefined) {
    return { type: "spentFuelLiters", value: options.fuelBudgetInLiters };
  }
  if (options.chargeBudgetPercent !== undefined) {
    return { type: "spentChargePCT", value: options.chargeBudgetPercent };
  }
  if (options.remainingChargeBudgetPercent !== undefined) {
    return { type: "remainingChargeCPT", value: options.remainingChargeBudgetPercent };
  }
  throw new IncorrectError(
    "At least one budget parameter (time, distance, fuel, or charge) must be provided",
    { provided_options: Object.keys(options) }
  );
}

/**
 * Build SDK ReachableRangeParams from user options.
 */
function buildSdkReachableRangeParams(
  origin: Position,
  options: ReachableRangeOptionsOrbis
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    origin,
    budget: buildBudget(options),
  };

  // Cost model (routeType, traffic, avoid)
  const costModel: Record<string, unknown> = {};
  if (options.routeType) costModel.routeType = options.routeType;
  if (options.traffic) costModel.traffic = options.traffic;
  if (options.avoid) {
    costModel.avoid = Array.isArray(options.avoid) ? options.avoid : [options.avoid];
  }
  if (Object.keys(costModel).length > 0) params.costModel = costModel;

  // Travel mode
  if (options.travelMode) params.travelMode = options.travelMode;

  // Departure time
  if (options.departAt) {
    params.when = { option: "departAt", date: new Date(options.departAt) };
  }

  // Vehicle parameters
  const vehicle: Record<string, unknown> = {};
  if (options.vehicleEngineType) vehicle.engineType = options.vehicleEngineType;
  if (options.vehicleMaxSpeed) vehicle.maxSpeedInKilometersPerHour = options.vehicleMaxSpeed;
  if (options.vehicleWeight) vehicle.weightInKilograms = options.vehicleWeight;
  if (options.constantSpeedConsumptionInkWhPerHundredkm) {
    vehicle.constantSpeedConsumptionInkWhPerHundredkm = options.constantSpeedConsumptionInkWhPerHundredkm;
  }
  if (options.constantSpeedConsumptionInLitersPerHundredkm) {
    vehicle.constantSpeedConsumptionInLitersPerHundredkm = options.constantSpeedConsumptionInLitersPerHundredkm;
  }
  if (options.currentChargeInkWh !== undefined) vehicle.currentChargeInkWh = options.currentChargeInkWh;
  if (options.maxChargeInkWh !== undefined) vehicle.maxChargeInkWh = options.maxChargeInkWh;
  if (options.auxiliaryPowerInkW !== undefined) vehicle.auxiliaryPowerInkW = options.auxiliaryPowerInkW;
  if (options.currentFuelInLiters !== undefined) vehicle.currentFuelInLiters = options.currentFuelInLiters;
  if (options.auxiliaryPowerInLitersPerHour !== undefined) vehicle.auxiliaryPowerInLitersPerHour = options.auxiliaryPowerInLitersPerHour;
  if (options.fuelEnergyDensityInMJoulesPerLiter !== undefined) vehicle.fuelEnergyDensityInMJoulesPerLiter = options.fuelEnergyDensityInMJoulesPerLiter;
  if (options.accelerationEfficiency !== undefined) vehicle.accelerationEfficiency = options.accelerationEfficiency;
  if (options.decelerationEfficiency !== undefined) vehicle.decelerationEfficiency = options.decelerationEfficiency;
  if (options.uphillEfficiency !== undefined) vehicle.uphillEfficiency = options.uphillEfficiency;
  if (options.downhillEfficiency !== undefined) vehicle.downhillEfficiency = options.downhillEfficiency;
  if (Object.keys(vehicle).length > 0) params.vehicle = vehicle;

  return params;
}

/**
 * Generate budget step values around the requested value.
 * Creates ~4 concentric ring levels: 0.5x, 1x, 1.5x, 2x of the requested budget.
 * Percentage-based budgets are capped at 100.
 */
function generateBudgetSteps(budget: { type: BudgetType; value: number }): number[] {
  const base = budget.value;
  const isPercentage = budget.type === "spentChargePCT" || budget.type === "remainingChargeCPT";
  const cap = isPercentage ? 100 : Infinity;

  const multipliers = [0.5, 1.0, 1.5, 2.0];
  const steps = multipliers
    .map((m) => Math.round(base * m))
    .filter((v) => v > 0 && v <= cap);

  // Deduplicate and sort descending (largest ring first for proper layering)
  return [...new Set(steps)].sort((a, b) => b - a);
}

/**
 * Calculate reachable ranges from a starting point using SDK.
 * Returns a GeoJSON FeatureCollection with multiple concentric range polygons
 * at different budget levels around the requested value.
 * @param origin [longitude, latitude] (GeoJSON convention)
 */
export async function getReachableRange(
  origin: Position,
  options: ReachableRangeOptionsOrbis
): Promise<Awaited<ReturnType<typeof calculateReachableRanges>>> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error("API key not available");

  logger.debug(
    { origin: { lng: origin[0], lat: origin[1] } },
    "Calculating reachable ranges via SDK"
  );

  // Build base params (without budget — we'll set budget per step)
  const baseParams = buildSdkReachableRangeParams(origin, options);
  baseParams.apiKey = apiKey;
  const budget = baseParams.budget as { type: BudgetType; value: number };

  // Generate multiple budget levels for concentric rings
  const steps = generateBudgetSteps(budget);
  logger.debug({ budget_type: budget.type, steps }, "Generated budget steps");

  const paramsArray = steps.map((value) => ({
    ...baseParams,
    budget: { type: budget.type, value },
  })) as Parameters<typeof calculateReachableRanges>[0];

  logger.debug({ stepCount: paramsArray.length }, "Calling calculateReachableRanges");

  let result: Awaited<ReturnType<typeof calculateReachableRanges>>;
  try {
    result = await calculateReachableRanges(paramsArray);
  } catch (error) {
    logger.warn({ error }, "calculateReachableRanges failed, falling back to single range");
    // Fallback: calculate just the requested budget using singular API
    const singleResult = await calculateReachableRange(
      baseParams as Parameters<typeof calculateReachableRange>[0]
    );
    result = {
      type: "FeatureCollection",
      features: [singleResult],
      bbox: singleResult.bbox,
    } as unknown as Awaited<ReturnType<typeof calculateReachableRanges>>;
  }

  logger.info({ featureCount: result.features?.length ?? 0 }, "Reachable ranges computed");

  // If plural returned empty, fallback to singular
  if (!result.features?.length) {
    logger.warn("calculateReachableRanges returned empty features, falling back to single range");
    const singleResult = await calculateReachableRange(
      baseParams as Parameters<typeof calculateReachableRange>[0]
    );
    result = {
      type: "FeatureCollection",
      features: [singleResult],
      bbox: singleResult.bbox,
    } as unknown as Awaited<ReturnType<typeof calculateReachableRanges>>;
    logger.info({ featureCount: result.features.length }, "Single range fallback succeeded");
  }

  // Tag the requested budget value so the MCP app can default to it
  (result as Record<string, unknown>).requestedBudgetValue = budget.value;

  return result;
}
