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
  type CalculateRouteParams,
  type CostModel,
  type VehicleParameters,
} from "@tomtom-org/maps-sdk/services";
import type { Routes } from "@tomtom-org/maps-sdk/core";
import type { Position } from "geojson";
import { requireApiKey } from "../base/tomtomClient";
import { logger } from "../../utils/logger";
import { IncorrectError } from "../../types/types";
import type { RoutingParams } from "../../schemas/routing/routingSchema";
import { toMaxAlternatives, toWhen } from "../shared/sdkInputs";

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
  | "vehicleMaxSpeed"
  | "vehicleWeight"
>;

function buildSdkCostModel(options: RouteOptions): CostModel | undefined {
  const costModel: CostModel = {};
  if (options.routeType) costModel.routeType = options.routeType;
  if (options.traffic) costModel.traffic = options.traffic;
  if (options.avoid?.length) costModel.avoid = options.avoid;
  return Object.keys(costModel).length > 0 ? costModel : undefined;
}

function buildSdkVehicleParams(options: RouteOptions): VehicleParameters | undefined {
  const vehicle: VehicleParameters = {};
  if (options.vehicleMaxSpeed) vehicle.restrictions = { maxSpeedKMH: options.vehicleMaxSpeed };
  if (options.vehicleWeight) vehicle.model = { dimensions: { weightKG: options.vehicleWeight } };
  if (options.vehicleHeading !== undefined) vehicle.state = { heading: options.vehicleHeading };
  return Object.keys(vehicle).length > 0 ? vehicle : undefined;
}

function buildSdkRouteParams(
  apiKey: string,
  locations: Position[],
  options: RouteOptions = {}
): CalculateRouteParams {
  const params: CalculateRouteParams = { apiKey, locations };

  const costModel = buildSdkCostModel(options);
  if (costModel) params.costModel = costModel;

  if (options.travelMode) params.travelMode = options.travelMode;

  const when = toWhen(options);
  if (when) params.when = when;

  const maxAlternatives = toMaxAlternatives(options.maxAlternatives);
  if (maxAlternatives !== undefined) params.maxAlternatives = maxAlternatives;

  if (options.sectionType?.length) params.sectionTypes = options.sectionType;

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
