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
  type CommonRoutingParams,
  type CostModel,
  type ReachableRangeAvoidable,
  type ReachableRangeCostModel,
  type ReachableRangeParams,
  type ReachableRangeVehicleParameters,
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
import type { RoutingParams } from "../../schemas/routing/routingSchema";
import { toDepartAt, toMaxAlternatives, toWhen } from "../shared/sdkInputs";
import type { ReachableRangeOptions, VehicleOptionKey } from "./types";

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
  | VehicleOptionKey
>;

type CommonRoutingOptions = Pick<RouteOptions, "routeType" | "traffic" | "travelMode"> & {
  avoid?: Avoidable[];
};
type CommonRouting<C> = Pick<CommonRoutingParams, "travelMode"> & { costModel?: C };

/**
 * The cost model and travel mode the routing and reachable-range builders share.
 * The time is left to each builder: reachable range takes a departure time only.
 * Reachable range gets the SDK's narrower cost model, without the avoids it has no
 * parameter for.
 */
function buildCommonRoutingParams(
  options: CommonRoutingOptions & { avoid?: ReachableRangeAvoidable[] }
): CommonRouting<ReachableRangeCostModel>;
function buildCommonRoutingParams(options: CommonRoutingOptions): CommonRouting<CostModel>;
function buildCommonRoutingParams(options: CommonRoutingOptions): CommonRouting<CostModel> {
  const costModel: CostModel = {};
  if (options.routeType) costModel.routeType = options.routeType;
  if (options.traffic) costModel.traffic = options.traffic;
  if (options.avoid?.length) costModel.avoid = options.avoid;

  const params: CommonRouting<CostModel> = {};
  if (Object.keys(costModel).length > 0) params.costModel = costModel;
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

  const vehicle = withHeading(buildSdkVehicleParams(options), options.vehicleHeading);
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
const BUDGET_KEYS = ["timeBudgetInSec", "distanceBudgetInMeters"] as const;

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
  throw new IncorrectError(
    "At least one budget parameter (timeBudgetInSec or distanceBudgetInMeters) must be provided",
    { provided_options: Object.keys(options) }
  );
}

/** The vehicle without a heading, which only a route takes: the reachable-range endpoint rejects it. */
function buildSdkVehicleParams(
  options: Pick<ReachableRangeOptions, VehicleOptionKey>
): ReachableRangeVehicleParameters | undefined {
  const vehicle: ReachableRangeVehicleParameters = {};
  if (options.vehicleMaxSpeed) vehicle.restrictions = { maxSpeedKMH: options.vehicleMaxSpeed };
  if (options.vehicleWeight) vehicle.model = { dimensions: { weightKG: options.vehicleWeight } };
  return Object.keys(vehicle).length > 0 ? vehicle : undefined;
}

function withHeading(
  vehicle: ReachableRangeVehicleParameters | undefined,
  heading: number | undefined
): VehicleParameters | undefined {
  if (heading === undefined) return vehicle;
  return { ...vehicle, state: { heading } };
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
  // key. Keep only the budget and origin, which the widget reads.
  const { budget, origin: rangeOrigin } = range.properties;
  return {
    type: "FeatureCollection",
    features: [{ ...range, properties: { budget, origin: rangeOrigin } }],
    bbox: range.bbox,
  };
}
