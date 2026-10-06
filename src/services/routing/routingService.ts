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
  type CalculateRouteParams,
  type CombustionVehicleParams,
  type CommonRoutingParams,
  type CostModel,
  type ElectricVehicleParams,
  type GenericVehicleParams,
  type ReachableRangeParams,
  type VehicleParameters,
} from "@tomtom-org/maps-sdk/services";
import type {
  Avoidable,
  PolygonFeatures,
  ReachableRangeBudget,
  Routes,
} from "@tomtom-org/maps-sdk/core";
import type { Position } from "geojson";
import { requireApiKey } from "../base/tomtomClient";
import { logger } from "../../utils/logger";
import { IncorrectError } from "../../types/types";
import type { EvRoutingParams, RoutingParams } from "../../schemas/routing/routingSchema";
import { toDepartAt, toMaxAlternatives, toWhen } from "../shared/sdkInputs";
import type { ReachableRangeOptions, VehicleOptionKey } from "./types";

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
/** The SDK's own SpeedToConsumptionRate[], shared by the combustion and electric curves. */
type SpeedToConsumptionRates = CombustionConsumption["speedsToConsumptionsLiters"];
type VehicleDimensions = NonNullable<CombustionModel["dimensions"]>;
/** The SDK's own (unexported) VehicleRestrictions: the restrictions any vehicle can carry. */
type VehicleRestrictions = Pick<VehicleParameters, "restrictions">;
type Restrictions = NonNullable<VehicleRestrictions["restrictions"]>;

/** The routing tool inputs the service maps to SDK parameters. */
export type RouteOptions = Pick<
  RoutingParams,
  | "routeType"
  | "traffic"
  | "avoid"
  | "travelMode"
  | "departAt"
  | "arriveAt"
  | "maxAlternatives"
  | "sectionType"
  | "vehicleHeading"
  | Exclude<VehicleOptionKey, "currentFuelInLiters" | "currentChargeInkWh">
>;

/**
 * Cost-model inputs, shared by the routing, reachable-range and EV-routing tools.
 * Generic in the avoids, since reachable range takes fewer than a route.
 */
type CostModelOptions<A extends Avoidable> = Pick<RouteOptions, "routeType" | "traffic"> & {
  avoid?: A[];
};
type CostModelOf<A extends Avoidable> = Omit<CostModel, "avoid" | "avoidAreas"> & { avoid?: A[] };

function buildCostModel<A extends Avoidable>(
  options: CostModelOptions<A>
): CostModelOf<A> | undefined {
  const costModel: CostModelOf<A> = {};
  if (options.routeType) costModel.routeType = options.routeType;
  if (options.traffic) costModel.traffic = options.traffic;
  if (options.avoid?.length) costModel.avoid = options.avoid;
  return Object.keys(costModel).length > 0 ? costModel : undefined;
}

type CommonRoutingOptions<A extends Avoidable> = CostModelOptions<A> &
  Pick<RouteOptions, "travelMode">;

/**
 * The cost model and travel mode the routing, reachable-range and EV-routing
 * builders share. The time is left to each builder: reachable range and EV
 * routing take a departure time only.
 */
function buildCommonRoutingParams<A extends Avoidable>(
  options: CommonRoutingOptions<A>
): Pick<CommonRoutingParams, "travelMode"> & { costModel?: CostModelOf<A> } {
  const params: Pick<CommonRoutingParams, "travelMode"> & { costModel?: CostModelOf<A> } = {};
  const costModel = buildCostModel(options);
  if (costModel) params.costModel = costModel;
  if (options.travelMode) params.travelMode = options.travelMode;
  return params;
}

function buildSdkRouteParams(
  apiKey: string,
  locations: Position[],
  options: RouteOptions = {}
): CalculateRouteParams {
  const params: CalculateRouteParams = {
    apiKey,
    locations,
    ...buildCommonRoutingParams(options),
  };

  const when = toWhen(options);
  if (when) params.when = when;

  const maxAlternatives = toMaxAlternatives(options.maxAlternatives);
  if (maxAlternatives !== undefined) params.maxAlternatives = maxAlternatives;

  if (options.sectionType?.length) params.sectionTypes = options.sectionType;

  const vehicle = buildSdkVehicleParams(options, "full", options.vehicleHeading);
  if (vehicle) params.vehicle = vehicle;

  return params;
}

export async function getRoute(locations: Position[], options?: RouteOptions): Promise<Routes> {
  const apiKey = requireApiKey();

  if (locations.length < 2) {
    throw new IncorrectError("At least two locations (origin and destination) are required", {
      location_count: locations.length,
      minimum_required: 2,
    });
  }

  logger.debug({ location_count: locations.length }, "Calculating route via SDK");

  return calculateRoute(buildSdkRouteParams(apiKey, locations, options));
}

/** The widget's budgetSteps checks the budget parameters in this same order. */
const BUDGET_KEYS = [
  "timeBudgetInSec",
  "distanceBudgetInMeters",
  "fuelBudgetInLiters",
  "energyBudgetInkWh",
  "chargeBudgetPercent",
  "remainingChargeBudgetPercent",
] as const;

function buildBudget(options: ReachableRangeOptions): ReachableRangeBudget {
  const given = BUDGET_KEYS.filter((key) => options[key] !== undefined);
  if (given.length > 1) {
    throw new IncorrectError("Give one budget parameter", { budgets: given });
  }
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
    const max = requireBatterySize("energyBudgetInkWh", options);
    return { type: "spentChargePCT", value: (options.energyBudgetInkWh / max) * 100 };
  }
  if (options.chargeBudgetPercent !== undefined) {
    requireBatterySize("chargeBudgetPercent", options);
    return { type: "spentChargePCT", value: options.chargeBudgetPercent };
  }
  if (options.remainingChargeBudgetPercent !== undefined) {
    requireBatterySize("remainingChargeBudgetPercent", options);
    return { type: "remainingChargePCT", value: options.remainingChargeBudgetPercent };
  }
  throw new IncorrectError(
    "At least one budget parameter (time, distance, energy, fuel, or charge) must be provided",
    { provided_options: Object.keys(options) }
  );
}

/** The SDK turns a charge budget into kWh with the battery size, and drops it without one. */
function requireBatterySize(
  budget: (typeof BUDGET_KEYS)[number],
  options: ReachableRangeOptions
): number {
  if (!options.maxChargeInkWh) {
    throw new IncorrectError(`maxChargeInkWh is required when using ${budget}`, {
      [budget]: options[budget],
    });
  }
  return options.maxChargeInkWh;
}

/**
 * A charge budget is spent from the current charge. The API refuses a budget above it,
 * and the SDK turns a remaining level at or above it into an empty budget.
 */
function requireChargeToSpend(budget: ReachableRangeBudget, options: ReachableRangeOptions): void {
  const { currentChargeInkWh: current, maxChargeInkWh: max } = options;
  if (current === undefined || !max) return;
  const currentPercent = (current / max) * 100;
  const exceeds =
    (budget.type === "spentChargePCT" && budget.value > currentPercent) ||
    (budget.type === "remainingChargePCT" && budget.value >= currentPercent);
  if (!exceeds) return;
  const given = BUDGET_KEYS.filter((key) => options[key] !== undefined);
  throw new IncorrectError(
    "The charge budget exceeds the current charge: energyBudgetInkWh and chargeBudgetPercent at most currentChargeInkWh, remainingChargeBudgetPercent below it",
    {
      ...Object.fromEntries(given.map((key) => [key, options[key]])),
      currentChargeInkWh: current,
      maxChargeInkWh: max,
    }
  );
}

function parseSpeedConsumption(input: string): SpeedToConsumptionRates {
  return input.split(":").map((pair) => {
    const [speed, consumption] = pair.split(",").map(Number);
    return { speedKMH: speed, consumptionUnitsPer100KM: consumption };
  });
}

type VehicleOptions = Pick<ReachableRangeOptions, VehicleOptionKey>;

function buildEfficiency(options: VehicleOptions): ConsumptionEfficiency | undefined {
  const efficiency: ConsumptionEfficiency = {};
  if (options.accelerationEfficiency !== undefined)
    efficiency.acceleration = options.accelerationEfficiency;
  if (options.decelerationEfficiency !== undefined)
    efficiency.deceleration = options.decelerationEfficiency;
  if (options.uphillEfficiency !== undefined) efficiency.uphill = options.uphillEfficiency;
  if (options.downhillEfficiency !== undefined) efficiency.downhill = options.downhillEfficiency;
  if (Object.keys(efficiency).length === 0) return undefined;
  for (const [a, b] of [
    ["acceleration", "deceleration"],
    ["uphill", "downhill"],
  ] as const) {
    if ((efficiency[a] === undefined) !== (efficiency[b] === undefined)) {
      throw new IncorrectError(`${a}Efficiency and ${b}Efficiency go together`, {
        efficiency_params: Object.keys(efficiency),
      });
    }
  }
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
    throw new IncorrectError("A speed-consumption curve is required for these parameters", {
      required_param: curveParam,
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
      currentFuelInLiters: options.currentFuelInLiters,
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
  if ((options.fuelEnergyDensityInMJoulesPerLiter === undefined) !== !efficiency) {
    throw new IncorrectError(
      "fuelEnergyDensityInMJoulesPerLiter and the efficiency parameters go together for combustion vehicles",
      { fuelEnergyDensityInMJoulesPerLiter: options.fuelEnergyDensityInMJoulesPerLiter, efficiency }
    );
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
      currentChargeInkWh: options.currentChargeInkWh,
      auxiliaryPowerInkW: options.auxiliaryPowerInkW,
      maxChargeInkWh: options.maxChargeInkWh,
      "efficiency parameters": efficiency,
      consumptionInkWhPerkmAltitudeGain: options.consumptionInkWhPerkmAltitudeGain,
      recuperationInkWhPerkmAltitudeLoss: options.recuperationInkWhPerkmAltitudeLoss,
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
  Object.assign(consumption, buildAltitudeConsumption(options, efficiency));

  const engine: ElectricEngine = { consumption };
  if (options.maxChargeInkWh !== undefined) {
    engine.charging = { maxChargeKWH: options.maxChargeInkWh };
  }
  return engine;
}

/** The API takes the altitude pair together, and never with the efficiency parameters. */
function buildAltitudeConsumption(
  options: VehicleOptions,
  efficiency: ConsumptionEfficiency | undefined
): Pick<
  ElectricConsumption,
  "consumptionInKWHPerKMAltitudeGain" | "recuperationInKWHPerKMAltitudeLoss"
> {
  const gain = options.consumptionInkWhPerkmAltitudeGain;
  const loss = options.recuperationInkWhPerkmAltitudeLoss;
  if (gain === undefined && loss === undefined) return {};
  if (gain === undefined || loss === undefined) {
    throw new IncorrectError(
      "consumptionInkWhPerkmAltitudeGain and recuperationInkWhPerkmAltitudeLoss go together",
      { consumptionInkWhPerkmAltitudeGain: gain, recuperationInkWhPerkmAltitudeLoss: loss }
    );
  }
  if (efficiency) {
    throw new IncorrectError(
      "The altitude parameters cannot be combined with efficiency parameters",
      {
        efficiency_params: Object.keys(efficiency),
      }
    );
  }
  return { consumptionInKWHPerKMAltitudeGain: gain, recuperationInKWHPerKMAltitudeLoss: loss };
}

/** Vehicle fields that apply whatever the engine type. */
interface CommonVehicleParts {
  restrictions?: Restrictions;
  dimensions?: VehicleDimensions;
}

function buildCombustionVehicle(
  options: VehicleOptions,
  { restrictions, dimensions }: CommonVehicleParts
): CombustionVehicleParams & VehicleRestrictions {
  const consumption = buildCombustionConsumption(options, buildEfficiency(options));
  const model: CombustionModel = {};
  if (dimensions) model.dimensions = dimensions;
  if (consumption) model.engine = { consumption };

  const vehicle: CombustionVehicleParams & VehicleRestrictions = { engineType: "combustion" };
  if (Object.keys(model).length > 0) vehicle.model = model;
  if (options.currentFuelInLiters !== undefined) {
    vehicle.state = { currentFuelInLiters: options.currentFuelInLiters };
  }
  if (restrictions) vehicle.restrictions = restrictions;
  return vehicle;
}

/**
 * How the battery charge is sent: in kWh or as a percentage of the battery, or as a
 * full battery for a route, where the API needs a charge with the battery size but ignores it.
 */
type ChargeMode = "kWh" | "percent" | "full";

function buildChargeState(
  options: VehicleOptions,
  mode: ChargeMode
): ElectricVehicleParams["state"] {
  const max = options.maxChargeInkWh;
  if (mode === "full") return max === undefined ? undefined : { currentChargeInkWh: max };
  const current = options.currentChargeInkWh;
  if (current === undefined && max === undefined) return undefined;
  if (current === undefined || max === undefined || current <= 0 || current > max) {
    throw new IncorrectError(
      "currentChargeInkWh and maxChargeInkWh go together, with 0 < currentChargeInkWh <= maxChargeInkWh",
      { currentChargeInkWh: current, maxChargeInkWh: max }
    );
  }
  return mode === "percent"
    ? { currentChargePCT: (current / max) * 100 }
    : { currentChargeInkWh: current };
}

function buildElectricVehicle(
  options: VehicleOptions,
  { restrictions, dimensions }: CommonVehicleParts,
  chargeMode: ChargeMode
): ElectricVehicleParams & VehicleRestrictions {
  const engine = buildElectricEngine(options, buildEfficiency(options));
  const model: ElectricModel = {};
  if (dimensions) model.dimensions = dimensions;
  if (engine) model.engine = engine;

  const vehicle: ElectricVehicleParams & VehicleRestrictions = { engineType: "electric" };
  if (Object.keys(model).length > 0) vehicle.model = model;
  const state = buildChargeState(options, chargeMode);
  if (state) vehicle.state = state;
  if (restrictions) vehicle.restrictions = restrictions;
  return vehicle;
}

/** The vehicle inputs only one engine type reads; the efficiencies need either. */
const ENGINE_INPUTS = {
  electric: [
    "currentChargeInkWh",
    "maxChargeInkWh",
    "constantSpeedConsumptionInkWhPerHundredkm",
    "auxiliaryPowerInkW",
    "consumptionInkWhPerkmAltitudeGain",
    "recuperationInkWhPerkmAltitudeLoss",
  ],
  combustion: [
    "currentFuelInLiters",
    "constantSpeedConsumptionInLitersPerHundredkm",
    "auxiliaryPowerInLitersPerHour",
    "fuelEnergyDensityInMJoulesPerLiter",
  ],
  either: [
    "accelerationEfficiency",
    "decelerationEfficiency",
    "uphillEfficiency",
    "downhillEfficiency",
  ],
} satisfies Record<string, VehicleOptionKey[]>;

/** Throws when engine inputs come without the vehicleEngineType that reads them. */
function requireEngineType(options: VehicleOptions): void {
  const engine = options.vehicleEngineType;
  const given = (keys: VehicleOptionKey[]) => keys.filter((key) => options[key] !== undefined);
  const mismatched = Object.entries({
    params_needing_electric: engine === "electric" ? [] : given(ENGINE_INPUTS.electric),
    params_needing_combustion: engine === "combustion" ? [] : given(ENGINE_INPUTS.combustion),
    params_needing_engine_type: engine ? [] : given(ENGINE_INPUTS.either),
  }).filter(([, params]) => params.length > 0);
  if (mismatched.length === 0) return;
  throw new IncorrectError("These vehicle parameters need a matching vehicleEngineType", {
    vehicleEngineType: engine,
    ...Object.fromEntries(mismatched),
  });
}

/**
 * @param chargeMode "percent" for a remaining-charge budget, which the SDK needs as a
 *   percentage; "full" for a route
 * @param heading the route's vehicleHeading. The SDK sends it from the vehicle state,
 *   and takes an engine's state only with its fuel or charge level, which a route has
 *   only for an electric vehicle with its battery size.
 */
function buildSdkVehicleParams(
  options: VehicleOptions,
  chargeMode: ChargeMode,
  heading?: number
): VehicleParameters | undefined {
  requireEngineType(options);
  const common: CommonVehicleParts = {};
  if (options.vehicleMaxSpeed) common.restrictions = { maxSpeedKMH: options.vehicleMaxSpeed };
  if (options.vehicleWeight) common.dimensions = { weightKG: options.vehicleWeight };

  if (options.vehicleEngineType === undefined) {
    if (!common.restrictions && !common.dimensions && heading === undefined) return undefined;
    const vehicle: GenericVehicleParams & VehicleRestrictions = {};
    if (common.dimensions) vehicle.model = { dimensions: common.dimensions };
    if (common.restrictions) vehicle.restrictions = common.restrictions;
    if (heading !== undefined) vehicle.state = { heading };
    return vehicle;
  }

  const vehicle =
    options.vehicleEngineType === "electric"
      ? buildElectricVehicle(options, common, chargeMode)
      : buildCombustionVehicle(options, common);
  if (heading === undefined) return vehicle;
  if (vehicle.engineType !== "electric" || !vehicle.state) {
    throw new IncorrectError(
      "vehicleHeading needs no vehicleEngineType, or 'electric' with maxChargeInkWh",
      { vehicleHeading: heading, vehicleEngineType: options.vehicleEngineType }
    );
  }
  vehicle.state = { ...vehicle.state, heading };
  return vehicle;
}

/** The vehicle inputs a time or distance range ignores: only the speed and weight shape it. */
const CONSUMPTION_MODEL_KEYS: VehicleOptionKey[] = [
  "vehicleEngineType",
  ...ENGINE_INPUTS.electric,
  ...ENGINE_INPUTS.combustion,
  ...ENGINE_INPUTS.either,
];

function requireConsumptionBudget(budget: ReachableRangeBudget, options: VehicleOptions): void {
  if (budget.type !== "timeMinutes" && budget.type !== "distanceKM") return;
  const ignored = CONSUMPTION_MODEL_KEYS.filter((key) => options[key] !== undefined);
  if (ignored.length > 0) {
    throw new IncorrectError(
      "A time or distance range ignores the engine and consumption model: use these inputs with a fuel, energy or charge budget",
      { ignored_params: ignored }
    );
  }
}

function buildSdkReachableRangeParams(
  apiKey: string,
  origin: Position,
  options: ReachableRangeOptions
): ReachableRangeParams {
  const params: ReachableRangeParams = {
    apiKey,
    origin,
    budget: buildBudget(options),
    ...buildCommonRoutingParams(options),
  };

  const when = toDepartAt(options.departAt);
  if (when) params.when = when;

  requireConsumptionBudget(params.budget, options);
  const vehicle = buildSdkVehicleParams(
    options,
    params.budget.type === "remainingChargePCT" ? "percent" : "kWh"
  );
  if (vehicle) params.vehicle = vehicle;
  requireChargeToSpend(params.budget, options);

  return params;
}

/** What the range carries in its properties: its budget and origin. */
export type ReachableRangeProperties = Pick<ReachableRangeParams, "budget" | "origin">;

/** The range for the requested budget, as a one-feature collection. */
export type ReachableRangeResult = PolygonFeatures<ReachableRangeProperties>;

/**
 * Computes the range for the requested budget only. The widget fetches other
 * budgets itself when the user switches to one.
 */
export async function getReachableRange(
  origin: Position,
  options: ReachableRangeOptions
): Promise<ReachableRangeResult> {
  const apiKey = requireApiKey();

  logger.debug(
    { origin: { lng: origin[0], lat: origin[1] } },
    "Calculating reachable range via SDK"
  );

  const params = buildSdkReachableRangeParams(apiKey, origin, options);
  const range = await calculateReachableRange(params);

  // The SDK copies every request param into the properties, including the API
  // key. Keep only the budget and origin, which the widget reads.
  const { budget, origin: rangeOrigin } = range.properties;
  return {
    type: "FeatureCollection",
    features: [{ ...range, properties: { budget, origin: rangeOrigin } }],
    bbox: range.bbox,
  };
}

// ---------------------------------------------------------------------------
// Long Distance EV Routing
// ---------------------------------------------------------------------------

export type EVRoutingOptions = Pick<
  EvRoutingParams,
  | "origin"
  | "destination"
  | "waypoints"
  | "currentChargePercent"
  | "maxChargeKWH"
  | "minChargeAtDestinationPercent"
  | "minChargeAtChargingStopsPercent"
  | "batteryCurve"
  | "consumptionInKWH"
  | "routeType"
  | "traffic"
  | "avoid"
  | "departAt"
>;

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

const DEFAULT_EV_CONSUMPTION: SpeedToConsumptionRates = [
  { speedKMH: 32, consumptionUnitsPer100KM: 10.87 },
  { speedKMH: 77, consumptionUnitsPer100KM: 18.01 },
];

function buildSdkEVRouteParams(apiKey: string, params: EVRoutingOptions): CalculateRouteParams {
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

  const routeParams: CalculateRouteParams = {
    apiKey,
    locations,
    vehicle,
    ...buildCommonRoutingParams(params),
  };

  const when = toDepartAt(params.departAt);
  if (when) routeParams.when = when;

  return routeParams;
}

/**
 * Calculate a long distance EV route with automatic charging stop planning.
 *
 * Uses SDK's calculateRoute() with vehicle.engineType = 'electric' and
 * charging preferences to automatically insert optimal charging stops.
 */
export async function calculateEVRoute(params: EVRoutingOptions): Promise<Routes> {
  const apiKey = requireApiKey();

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
