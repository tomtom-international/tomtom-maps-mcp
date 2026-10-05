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
  type ReachableRangeBudget,
  type ReachableRangeParams,
  type VehicleParameters,
} from "@tomtom-org/maps-sdk/services";
import type { PolygonFeatures, Routes } from "@tomtom-org/maps-sdk/core";
import type { Position } from "geojson";
import { requireApiKey } from "../base/tomtomClient";
import { logger } from "../../utils/logger";
import { IncorrectError } from "../../types/types";
import type { EvRoutingParams, RoutingParams } from "../../schemas/routing/routingSchema";
import {
  toAvoidables,
  toDepartAt,
  toMaxAlternatives,
  toSectionTypes,
  toWhen,
} from "../shared/sdkInputs";
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
  | VehicleOptionKey
>;

/** Cost-model inputs, shared by the routing, reachable-range and EV-routing tools. */
type CostModelOptions = Pick<RouteOptions, "routeType" | "traffic" | "avoid">;

function buildCostModel(options: CostModelOptions): CostModel | undefined {
  const costModel: CostModel = {};
  if (options.routeType) costModel.routeType = options.routeType;
  if (options.traffic) costModel.traffic = options.traffic;
  const avoid = toAvoidables(options.avoid);
  if (avoid) costModel.avoid = avoid;
  return Object.keys(costModel).length > 0 ? costModel : undefined;
}

type CommonRoutingOptions = CostModelOptions & Pick<RouteOptions, "travelMode">;

/**
 * The cost model and travel mode the routing, reachable-range and EV-routing
 * builders share. The time is left to each builder: reachable range and EV
 * routing take a departure time only.
 */
function buildCommonRoutingParams(
  options: CommonRoutingOptions
): Pick<CommonRoutingParams, "costModel" | "travelMode"> {
  const params: Pick<CommonRoutingParams, "costModel" | "travelMode"> = {};
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

  const sectionTypes = toSectionTypes(options.sectionType);
  if (sectionTypes) params.sectionTypes = sectionTypes;

  const vehicle = buildSdkVehicleParams(options);
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
function buildBudget(options: ReachableRangeOptions): ReachableRangeBudget {
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

function buildElectricVehicle(
  options: VehicleOptions,
  { restrictions, dimensions }: CommonVehicleParts
): ElectricVehicleParams & VehicleRestrictions {
  const engine = buildElectricEngine(options, buildEfficiency(options));
  const model: ElectricModel = {};
  if (dimensions) model.dimensions = dimensions;
  if (engine) model.engine = engine;

  const vehicle: ElectricVehicleParams & VehicleRestrictions = { engineType: "electric" };
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
  const vehicle: GenericVehicleParams & VehicleRestrictions = {};
  if (common.dimensions) vehicle.model = { dimensions: common.dimensions };
  if (common.restrictions) vehicle.restrictions = common.restrictions;
  return vehicle;
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

  const vehicle = buildSdkVehicleParams(options);
  if (vehicle) params.vehicle = vehicle;

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
  // key (#283). Keep only the budget and origin, which the widget reads.
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
