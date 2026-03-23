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
import {
  type Routes,
  type Avoidable,
  type TravelMode,
  type Language,
} from "@tomtom-org/maps-sdk/core";
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

function buildSdkRouteParams(
  locations: Position[],
  options?: RouteOptions
): Record<string, unknown> {
  const params: Record<string, unknown> = { locations };

  const costModel: Record<string, unknown> = {};
  if (options?.routeType) costModel.routeType = options.routeType;
  if (options?.traffic) costModel.traffic = options.traffic;
  if (options?.avoid) {
    costModel.avoid = Array.isArray(options.avoid) ? options.avoid : [options.avoid];
  }
  if (Object.keys(costModel).length > 0) params.costModel = costModel;

  if (options?.travelMode) params.travelMode = options.travelMode;

  if (options?.departAt) {
    params.when = { option: "departAt", date: new Date(options.departAt) };
  } else if (options?.arriveAt) {
    params.when = { option: "arriveBy", date: new Date(options.arriveAt) };
  }

  if (options?.maxAlternatives !== undefined) params.maxAlternatives = options.maxAlternatives;
  if (options?.language) params.language = options.language;
  if (options?.instructionsType) {
    params.guidance = { type: options.instructionsType };
  }

  return params;
}

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
  if (options.energyBudgetInkWh !== undefined) {
    if (!options.maxChargeInkWh) {
      throw new IncorrectError("maxChargeInkWh is required when using energyBudgetInkWh", {
        energyBudgetInkWh: options.energyBudgetInkWh,
      });
    }
    const percent = (options.energyBudgetInkWh / options.maxChargeInkWh) * 100;
    return { type: "spentChargePCT", value: Math.min(percent, 100) };
  }
  if (options.chargeBudgetPercent !== undefined) {
    return { type: "spentChargePCT", value: options.chargeBudgetPercent };
  }
  if (options.remainingChargeBudgetPercent !== undefined) {
    return { type: "remainingChargeCPT", value: options.remainingChargeBudgetPercent };
  }
  throw new IncorrectError(
    "At least one budget parameter (time, distance, energy, fuel, or charge) must be provided",
    { provided_options: Object.keys(options) }
  );
}

function parseSpeedConsumption(
  input: string
): Array<{ speedKMH: number; consumptionUnitsPer100KM: number }> {
  return input.split(":").map((pair) => {
    const [speed, consumption] = pair.split(",").map(Number);
    return { speedKMH: speed, consumptionUnitsPer100KM: consumption };
  });
}

function buildSdkVehicleParams(
  options: ReachableRangeOptionsOrbis
): Record<string, unknown> | null {
  if (!options.vehicleEngineType) {
    const hasVehicleDimensions = options.vehicleMaxSpeed || options.vehicleWeight;
    if (!hasVehicleDimensions) return null;

    const vehicle: Record<string, unknown> = {};
    const restrictions: Record<string, unknown> = {};
    if (options.vehicleMaxSpeed) restrictions.maxSpeedInKilometersPerHour = options.vehicleMaxSpeed;
    if (options.vehicleWeight) {
      vehicle.model = { dimensions: { weightInKilograms: options.vehicleWeight } };
    }
    if (Object.keys(restrictions).length > 0) vehicle.restrictions = restrictions;
    return vehicle;
  }

  const vehicle: Record<string, unknown> = { engineType: options.vehicleEngineType };

  const efficiency: Record<string, unknown> = {};
  if (options.accelerationEfficiency !== undefined)
    efficiency.accelerationEfficiency = options.accelerationEfficiency;
  if (options.decelerationEfficiency !== undefined)
    efficiency.decelerationEfficiency = options.decelerationEfficiency;
  if (options.uphillEfficiency !== undefined)
    efficiency.uphillEfficiency = options.uphillEfficiency;
  if (options.downhillEfficiency !== undefined)
    efficiency.downhillEfficiency = options.downhillEfficiency;

  if (options.vehicleEngineType === "combustion") {
    const consumption: Record<string, unknown> = {};
    if (options.constantSpeedConsumptionInLitersPerHundredkm) {
      consumption.speedsToConsumptionsLiters = parseSpeedConsumption(
        options.constantSpeedConsumptionInLitersPerHundredkm
      );
    }
    if (options.auxiliaryPowerInLitersPerHour !== undefined) {
      consumption.auxiliaryPowerInLitersPerHour = options.auxiliaryPowerInLitersPerHour;
    }
    if (options.fuelEnergyDensityInMJoulesPerLiter !== undefined) {
      consumption.fuelEnergyDensityInMJoulesPerLiter = options.fuelEnergyDensityInMJoulesPerLiter;
    }
    if (Object.keys(efficiency).length > 0) consumption.efficiency = efficiency;

    if (Object.keys(consumption).length > 0) {
      vehicle.model = { engine: { consumption } };
    }

    const state: Record<string, unknown> = {};
    if (options.currentFuelInLiters !== undefined)
      state.currentFuelInLiters = options.currentFuelInLiters;
    if (Object.keys(state).length > 0) vehicle.state = state;
  } else if (options.vehicleEngineType === "electric") {
    const engine: Record<string, unknown> = {};

    const consumption: Record<string, unknown> = {};
    if (options.constantSpeedConsumptionInkWhPerHundredkm) {
      consumption.speedsToConsumptionsKWH = parseSpeedConsumption(
        options.constantSpeedConsumptionInkWhPerHundredkm
      );
    }
    if (options.auxiliaryPowerInkW !== undefined) {
      consumption.auxiliaryPowerInkW = options.auxiliaryPowerInkW;
    }
    if (Object.keys(efficiency).length > 0) consumption.efficiency = efficiency;
    if (Object.keys(consumption).length > 0) engine.consumption = consumption;

    if (options.maxChargeInkWh !== undefined) {
      engine.charging = { maxChargeKWH: options.maxChargeInkWh };
    }

    if (Object.keys(engine).length > 0) {
      vehicle.model = { engine };
    }

    if (options.currentChargeInkWh !== undefined && options.maxChargeInkWh) {
      const pct = Math.round((options.currentChargeInkWh / options.maxChargeInkWh) * 100);
      vehicle.state = { currentChargePCT: Math.min(pct, 100) };
    }
  }

  if (options.vehicleMaxSpeed || options.vehicleWeight) {
    const restrictions: Record<string, unknown> = {};
    if (options.vehicleMaxSpeed) restrictions.maxSpeedInKilometersPerHour = options.vehicleMaxSpeed;
    if (Object.keys(restrictions).length > 0) vehicle.restrictions = restrictions;
    if (options.vehicleWeight) {
      const existingModel = (vehicle.model as Record<string, unknown>) || {};
      existingModel.dimensions = { weightInKilograms: options.vehicleWeight };
      vehicle.model = existingModel;
    }
  }

  return vehicle;
}

function buildSdkReachableRangeParams(
  origin: Position,
  options: ReachableRangeOptionsOrbis
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    origin,
    budget: buildBudget(options),
  };

  const costModel: Record<string, unknown> = {};
  if (options.routeType) costModel.routeType = options.routeType;
  if (options.traffic) costModel.traffic = options.traffic;
  if (options.avoid) {
    costModel.avoid = Array.isArray(options.avoid) ? options.avoid : [options.avoid];
  }
  if (Object.keys(costModel).length > 0) params.costModel = costModel;

  if (options.travelMode) params.travelMode = options.travelMode;

  if (options.departAt) {
    params.when = { option: "departAt", date: new Date(options.departAt) };
  }

  const vehicle = buildSdkVehicleParams(options);
  if (vehicle) params.vehicle = vehicle;

  return params;
}

function generateBudgetSteps(budget: { type: BudgetType; value: number }): number[] {
  const base = budget.value;
  const isPercentage = budget.type === "spentChargePCT" || budget.type === "remainingChargeCPT";
  const cap = isPercentage ? 100 : Infinity;

  const multipliers = [0.5, 1.0, 1.5, 2.0];
  const steps = multipliers.map((m) => Math.round(base * m)).filter((v) => v > 0 && v <= cap);

  return [...new Set(steps)].sort((a, b) => b - a);
}

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

  const baseParams = buildSdkReachableRangeParams(origin, options);
  baseParams.apiKey = apiKey;
  const budget = baseParams.budget as { type: BudgetType; value: number };

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

  if (!result.features?.length) {
    logger.warn("calculateReachableRanges returned empty, falling back to single range");
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

  (result as Record<string, unknown>).requestedBudgetValue = budget.value;

  return result;
}
