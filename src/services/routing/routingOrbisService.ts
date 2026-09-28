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
  type CalculateRouteParams,
  type CombustionVehicleParams,
  type CostModel,
  type ElectricVehicleParams,
  type GenericVehicleParams,
  type ReachableRangeBudget,
  type ReachableRangeParams,
  type RouteType,
  type TrafficInput,
  type VehicleParameters,
} from "@tomtom-org/maps-sdk/services";
import type { PolygonFeatures, Routes } from "@tomtom-org/maps-sdk/core";
import type { Position } from "geojson";
import { getEffectiveApiKey } from "../base/tomtomClient";
import { logger } from "../../utils/logger";
import { IncorrectError } from "../../types/types";
import type {
  EvRoutingOrbisParams,
  RoutingOrbisParams,
} from "../../schemas/routing/routingOrbisSchema";
import { toAvoidables, toDate, toMaxAlternatives } from "../shared/sdkInputs";
import type { ReachableRangeOptionsOrbis, VehicleOptionKey } from "./types";

// Nested SDK parameter types. The SDK exports only the top-level vehicle
// types, so the nested ones are derived here; assigning to them is what lets
// the compiler reject a misspelt or misplaced key.
type ExplicitModel<M> = M extends { variantId: unknown } ? never : M;
type CombustionModel = ExplicitModel<NonNullable<CombustionVehicleParams["model"]>>;
type CombustionConsumption = NonNullable<CombustionModel["engine"]>["consumption"];
type ElectricModel = ExplicitModel<NonNullable<ElectricVehicleParams["model"]>>;
type ElectricEngine = NonNullable<ElectricModel["engine"]>;
type ElectricConsumption = ElectricEngine["consumption"];
type ConsumptionEfficiency = NonNullable<CombustionConsumption["efficiency"]>;
type VehicleDimensions = NonNullable<CombustionModel["dimensions"]>;
type VehicleRestrictions = NonNullable<VehicleParameters["restrictions"]>;

/** The routing tool inputs the service maps to SDK parameters. */
export type RouteOptions = Pick<
  RoutingOrbisParams,
  "routeType" | "traffic" | "avoid" | "travelMode" | "departAt" | "arriveAt" | "maxAlternatives"
>;

/** Cost-model inputs, shared by the routing, reachable-range and EV-routing tools. */
interface CostModelOptions {
  routeType?: RouteType;
  traffic?: TrafficInput;
  avoid?: string | string[];
}

function buildCostModel(options: CostModelOptions): CostModel | undefined {
  const costModel: CostModel = {};
  if (options.routeType) costModel.routeType = options.routeType;
  if (options.traffic) costModel.traffic = options.traffic;
  const avoid = toAvoidables(options.avoid);
  if (avoid) costModel.avoid = avoid;
  return Object.keys(costModel).length > 0 ? costModel : undefined;
}

function buildSdkRouteParams(
  apiKey: string,
  locations: Position[],
  options: RouteOptions = {}
): CalculateRouteParams {
  const params: CalculateRouteParams = { apiKey, locations };

  const costModel = buildCostModel(options);
  if (costModel) params.costModel = costModel;

  if (options.travelMode) params.travelMode = options.travelMode;

  if (options.departAt) {
    params.when = { option: "departAt", date: toDate(options.departAt, "departAt") };
  } else if (options.arriveAt) {
    params.when = { option: "arriveBy", date: toDate(options.arriveAt, "arriveAt") };
  }

  const maxAlternatives = toMaxAlternatives(options.maxAlternatives);
  if (maxAlternatives !== undefined) params.maxAlternatives = maxAlternatives;

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

  return calculateRoute(buildSdkRouteParams(apiKey, locations, options));
}

function buildBudget(options: ReachableRangeOptionsOrbis): ReachableRangeBudget {
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

function parseSpeedConsumption(input: string): CombustionConsumption["speedsToConsumptionsLiters"] {
  return input.split(":").map((pair) => {
    const [speed, consumption] = pair.split(",").map(Number);
    return { speedKMH: speed, consumptionUnitsPer100KM: consumption };
  });
}

type VehicleOptions = Pick<ReachableRangeOptionsOrbis, VehicleOptionKey>;

function buildEfficiency(options: VehicleOptions): ConsumptionEfficiency | undefined {
  const efficiency: ConsumptionEfficiency = {};
  if (options.accelerationEfficiency !== undefined)
    efficiency.acceleration = options.accelerationEfficiency;
  if (options.decelerationEfficiency !== undefined)
    efficiency.deceleration = options.decelerationEfficiency;
  if (options.uphillEfficiency !== undefined) efficiency.uphill = options.uphillEfficiency;
  if (options.downhillEfficiency !== undefined) efficiency.downhill = options.downhillEfficiency;
  if (Object.keys(efficiency).length === 0) return undefined;
  if (!options.vehicleWeight) {
    throw new IncorrectError("vehicleWeight is required when using efficiency parameters", {
      efficiency_params: Object.keys(efficiency),
    });
  }
  return efficiency;
}

/** Throws when consumption-model options are given without the speed-consumption curve they need. */
function requireConsumptionCurve(curveParam: string, dependents: Record<string, unknown>): void {
  const given = Object.entries(dependents)
    .filter(([, value]) => value !== undefined)
    .map(([name]) => name);
  if (given.length > 0) {
    throw new IncorrectError(`${curveParam} is required when using ${given.join(", ")}`, {
      params_needing_curve: given,
    });
  }
}

function buildCombustionConsumption(
  options: VehicleOptions,
  efficiency: ConsumptionEfficiency | undefined
): CombustionConsumption | undefined {
  const curve = options.constantSpeedConsumptionInLitersPerHundredkm;
  if (!curve) {
    requireConsumptionCurve("constantSpeedConsumptionInLitersPerHundredkm", {
      auxiliaryPowerInLitersPerHour: options.auxiliaryPowerInLitersPerHour,
      fuelEnergyDensityInMJoulesPerLiter: options.fuelEnergyDensityInMJoulesPerLiter,
      "efficiency parameters": efficiency,
    });
    return undefined;
  }

  const consumption: CombustionConsumption = {
    speedsToConsumptionsLiters: parseSpeedConsumption(curve),
  };
  if (options.auxiliaryPowerInLitersPerHour !== undefined) {
    consumption.auxiliaryPowerInLitersPerHour = options.auxiliaryPowerInLitersPerHour;
  }
  if (options.fuelEnergyDensityInMJoulesPerLiter !== undefined) {
    consumption.fuelEnergyDensityInMJoulesPerLiter = options.fuelEnergyDensityInMJoulesPerLiter;
  }
  if (efficiency) consumption.efficiency = efficiency;
  return consumption;
}

function buildElectricEngine(
  options: VehicleOptions,
  efficiency: ConsumptionEfficiency | undefined
): ElectricEngine | undefined {
  const curve = options.constantSpeedConsumptionInkWhPerHundredkm;
  if (!curve) {
    requireConsumptionCurve("constantSpeedConsumptionInkWhPerHundredkm", {
      auxiliaryPowerInkW: options.auxiliaryPowerInkW,
      maxChargeInkWh: options.maxChargeInkWh,
      "efficiency parameters": efficiency,
    });
    return undefined;
  }

  const consumption: ElectricConsumption = {
    speedsToConsumptionsKWH: parseSpeedConsumption(curve),
  };
  if (options.auxiliaryPowerInkW !== undefined) {
    consumption.auxiliaryPowerInkW = options.auxiliaryPowerInkW;
  }
  if (efficiency) consumption.efficiency = efficiency;

  const engine: ElectricEngine = { consumption };
  if (options.maxChargeInkWh !== undefined) {
    engine.charging = { maxChargeKWH: options.maxChargeInkWh };
  }
  return engine;
}

type WithRestrictions = Pick<VehicleParameters, "restrictions">;

/** Vehicle fields that apply whatever the engine type. */
interface CommonVehicleParts {
  restrictions?: VehicleRestrictions;
  dimensions?: VehicleDimensions;
}

function buildCombustionVehicle(
  options: VehicleOptions,
  { restrictions, dimensions }: CommonVehicleParts
): CombustionVehicleParams & WithRestrictions {
  const consumption = buildCombustionConsumption(options, buildEfficiency(options));
  const model: CombustionModel = {};
  if (dimensions) model.dimensions = dimensions;
  if (consumption) model.engine = { consumption };

  const vehicle: CombustionVehicleParams & WithRestrictions = { engineType: "combustion" };
  if (Object.keys(model).length > 0) vehicle.model = model;
  if (options.currentFuelInLiters !== undefined) {
    vehicle.state = { currentFuelInLiters: options.currentFuelInLiters };
  }
  if (restrictions) vehicle.restrictions = restrictions;
  return vehicle;
}

function buildElectricVehicle(
  options: VehicleOptions,
  { restrictions, dimensions }: CommonVehicleParts
): ElectricVehicleParams & WithRestrictions {
  const engine = buildElectricEngine(options, buildEfficiency(options));
  const model: ElectricModel = {};
  if (dimensions) model.dimensions = dimensions;
  if (engine) model.engine = engine;

  const vehicle: ElectricVehicleParams & WithRestrictions = { engineType: "electric" };
  if (Object.keys(model).length > 0) vehicle.model = model;
  if (options.currentChargeInkWh !== undefined && options.maxChargeInkWh) {
    const pct = Math.round((options.currentChargeInkWh / options.maxChargeInkWh) * 100);
    vehicle.state = { currentChargePCT: Math.min(pct, 100) };
  }
  if (restrictions) vehicle.restrictions = restrictions;
  return vehicle;
}

function buildSdkVehicleParams(options: VehicleOptions): VehicleParameters | undefined {
  const common: CommonVehicleParts = {};
  if (options.vehicleMaxSpeed) common.restrictions = { maxSpeedKMH: options.vehicleMaxSpeed };
  if (options.vehicleWeight) common.dimensions = { weightKG: options.vehicleWeight };

  if (options.vehicleEngineType === "combustion") return buildCombustionVehicle(options, common);
  if (options.vehicleEngineType === "electric") return buildElectricVehicle(options, common);

  if (!common.restrictions && !common.dimensions) return undefined;
  const vehicle: GenericVehicleParams & WithRestrictions = {};
  if (common.dimensions) vehicle.model = { dimensions: common.dimensions };
  if (common.restrictions) vehicle.restrictions = common.restrictions;
  return vehicle;
}

function buildSdkReachableRangeParams(
  apiKey: string,
  origin: Position,
  options: ReachableRangeOptionsOrbis
): ReachableRangeParams {
  const params: ReachableRangeParams = { apiKey, origin, budget: buildBudget(options) };

  const costModel = buildCostModel(options);
  if (costModel) params.costModel = costModel;

  if (options.travelMode) params.travelMode = options.travelMode;

  if (options.departAt) {
    params.when = { option: "departAt", date: toDate(options.departAt, "departAt") };
  }

  const vehicle = buildSdkVehicleParams(options);
  if (vehicle) params.vehicle = vehicle;

  return params;
}

function generateBudgetSteps(budget: ReachableRangeBudget): number[] {
  const base = budget.value;
  const isPercentage = budget.type === "spentChargePCT" || budget.type === "remainingChargeCPT";
  const cap = isPercentage ? 100 : Infinity;

  const multipliers = [0.5, 1.0, 1.5, 2.0];
  const steps = multipliers.map((m) => Math.round(base * m)).filter((v) => v > 0 && v <= cap);

  return [...new Set(steps)].sort((a, b) => b - a);
}

/** What each range carries in its properties: the ring's budget and origin. */
export type ReachableRangeProperties = Pick<ReachableRangeParams, "budget" | "origin">;

export type ReachableRangesResult = PolygonFeatures<ReachableRangeProperties> & {
  requestedBudgetValue: number;
};

/**
 * The SDK copies every request param into each range's properties, including
 * the API key (#283). Keep only the budget and origin, which the widget reads.
 */
function keepRangeProperties(
  result: SdkReachableRanges,
  requestedBudgetValue: number
): ReachableRangesResult {
  return {
    ...result,
    features: result.features.map((feature) => {
      const { budget, origin } = feature.properties;
      return { ...feature, properties: { budget, origin } };
    }),
    requestedBudgetValue,
  };
}

type SdkReachableRanges = Awaited<ReturnType<typeof calculateReachableRanges>>;

/** Fallback when the multi-range call fails or returns nothing: just the requested budget. */
async function calculateSingleRange(params: ReachableRangeParams): Promise<SdkReachableRanges> {
  const range = await calculateReachableRange(params);
  return { type: "FeatureCollection", features: [range], bbox: range.bbox };
}

export async function getReachableRange(
  origin: Position,
  options: ReachableRangeOptionsOrbis
): Promise<ReachableRangesResult> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error("API key not available");

  logger.debug(
    { origin: { lng: origin[0], lat: origin[1] } },
    "Calculating reachable ranges via SDK"
  );

  const baseParams = buildSdkReachableRangeParams(apiKey, origin, options);
  const budget = baseParams.budget;

  const steps = generateBudgetSteps(budget);
  logger.debug({ budget_type: budget.type, steps }, "Generated budget steps");

  const paramsArray: ReachableRangeParams[] = steps.map((value) => ({
    ...baseParams,
    budget: { type: budget.type, value },
  }));

  logger.debug({ stepCount: paramsArray.length }, "Calling calculateReachableRanges");

  let result: SdkReachableRanges;
  try {
    result = await calculateReachableRanges(paramsArray);
  } catch (error) {
    logger.warn({ error }, "calculateReachableRanges failed, falling back to single range");
    result = await calculateSingleRange(baseParams);
  }

  logger.info({ featureCount: result.features?.length ?? 0 }, "Reachable ranges computed");

  if (!result.features?.length) {
    logger.warn("calculateReachableRanges returned empty, falling back to single range");
    result = await calculateSingleRange(baseParams);
    logger.info({ featureCount: result.features.length }, "Single range fallback succeeded");
  }

  return keepRangeProperties(result, budget.value);
}

// ---------------------------------------------------------------------------
// Long Distance EV Routing
// ---------------------------------------------------------------------------

export type EVRoutingParams = Omit<EvRoutingOrbisParams, "show_ui" | "response_detail">;

type ElectricCharging = NonNullable<ElectricEngine["charging"]>;

// The SDK validates connector shape strictly: plug types use underscores, and
// efficiency and baseLoadInkW are required.
const DEFAULT_CHARGING_CONNECTORS: NonNullable<ElectricCharging["chargingConnectors"]> = [
  {
    currentType: "AC3",
    plugTypes: [
      "IEC_62196_Type_2_Outlet",
      "IEC_62196_Type_2_Connector_Cable_Attached",
      "Combo_to_IEC_62196_Type_2_Base",
    ],
    efficiency: 0.9,
    baseLoadInkW: 0.2,
    maxPowerInkW: 11,
  },
  {
    currentType: "DC",
    plugTypes: [
      "IEC_62196_Type_2_Outlet",
      "IEC_62196_Type_2_Connector_Cable_Attached",
      "Combo_to_IEC_62196_Type_2_Base",
    ],
    voltageRange: { minVoltageInV: 0, maxVoltageInV: 500 },
    efficiency: 0.9,
    baseLoadInkW: 0.2,
    maxPowerInkW: 150,
  },
];

const DEFAULT_BATTERY_CURVE: NonNullable<ElectricCharging["batteryCurve"]> = [
  { stateOfChargeInkWh: 50, maxPowerInkW: 200 },
  { stateOfChargeInkWh: 70, maxPowerInkW: 100 },
  { stateOfChargeInkWh: 80, maxPowerInkW: 40 },
];

const DEFAULT_EV_CONSUMPTION: ElectricConsumption["speedsToConsumptionsKWH"] = [
  { speedKMH: 32, consumptionUnitsPer100KM: 10.87 },
  { speedKMH: 77, consumptionUnitsPer100KM: 18.01 },
];

function buildSdkEVRouteParams(apiKey: string, params: EVRoutingParams): CalculateRouteParams {
  const locations: Position[] = [params.origin, ...(params.waypoints ?? []), params.destination];

  const vehicle: ElectricVehicleParams = {
    engineType: "electric",
    state: { currentChargePCT: params.currentChargePercent },
    preferences: {
      chargingPreferences: {
        minChargeAtDestinationPCT: params.minChargeAtDestinationPercent ?? 20,
        minChargeAtChargingStopsPCT: params.minChargeAtChargingStopsPercent ?? 10,
      },
    },
    model: {
      engine: {
        charging: {
          maxChargeKWH: params.maxChargeKWH,
          batteryCurve: params.batteryCurve ?? DEFAULT_BATTERY_CURVE,
          chargingConnectors: DEFAULT_CHARGING_CONNECTORS,
          chargingTimeOffsetInSec: 60,
        },
        // Required for charging stop calculation
        consumption: {
          speedsToConsumptionsKWH: params.consumptionInKWH ?? DEFAULT_EV_CONSUMPTION,
        },
      },
    },
  };

  const routeParams: CalculateRouteParams = { apiKey, locations, vehicle };

  const costModel = buildCostModel(params);
  if (costModel) routeParams.costModel = costModel;

  if (params.departAt) {
    routeParams.when = { option: "departAt", date: toDate(params.departAt, "departAt") };
  }

  return routeParams;
}

/**
 * Calculate a long distance EV route with automatic charging stop planning.
 *
 * Uses SDK's calculateRoute() with vehicle.engineType = 'electric' and
 * charging preferences to automatically insert optimal charging stops.
 */
export async function calculateEVRoute(params: EVRoutingParams): Promise<Routes> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error("API key not available");

  logger.debug(
    {
      origin: { lng: params.origin[0], lat: params.origin[1] },
      destination: { lng: params.destination[0], lat: params.destination[1] },
      chargePercent: params.currentChargePercent,
      maxChargeKWH: params.maxChargeKWH,
    },
    "Calculating EV route via SDK"
  );

  const routes = await calculateRoute(buildSdkEVRouteParams(apiKey, params));

  logger.debug({ routeCount: routes.features?.length }, "EV route calculation completed");

  return routes;
}
