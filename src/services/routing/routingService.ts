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

import { defaultSectionTypes, type Routes } from "@tomtom-org/maps-sdk/core";
import {
  type CalculateRouteParams,
  type CostModel,
  calculateRoute,
} from "@tomtom-org/maps-sdk/services";
import type { Position } from "geojson";
import type { PlanRouteParams } from "../../schemas/routing/planRouteSchema";
import { IncorrectError } from "../../types/types";
import { logger } from "../../utils/logger";
import { requireApiKey } from "../api-key";
import { toMaxAlternatives, toWhen } from "../shared/sdkInputs";

/** The routing tool inputs the service maps to SDK parameters. */
export type RouteOptions = Pick<
  PlanRouteParams,
  | "routeType"
  | "traffic"
  | "avoid"
  | "travelMode"
  | "departAt"
  | "arriveAt"
  | "maxAlternatives"
  | "curves"
>;

function buildSdkCostModel(options: RouteOptions): CostModel | undefined {
  const costModel: CostModel = {};
  if (options.routeType) costModel.routeType = options.routeType;
  if (options.traffic) costModel.traffic = options.traffic;
  if (options.avoid?.length) costModel.avoid = options.avoid;
  return Object.keys(costModel).length > 0 ? costModel : undefined;
}

/** What a caller of {@link getRoute} reads beyond the route itself. */
export interface RouteExtras {
  /** The turn-by-turn instructions, in `properties.guidance`. */
  guidance?: boolean;
}

function buildSdkRouteParams(
  apiKey: string,
  locations: Position[],
  options: RouteOptions = {},
  extras: RouteExtras = {}
): CalculateRouteParams {
  // "all" adds the free-flow and usual-traffic travel times to each summary, in the same request.
  const params: CalculateRouteParams = { apiKey, locations, computeTravelTimeFor: "all" };
  if (extras.guidance) params.guidance = { type: "coded" };

  const costModel = buildSdkCostModel(options);
  if (costModel) params.costModel = costModel;

  if (options.travelMode) params.travelMode = options.travelMode;

  const when = toWhen(options);
  if (when) params.when = when;

  const maxAlternatives = toMaxAlternatives(options.maxAlternatives);
  if (maxAlternatives !== undefined) params.maxAlternatives = maxAlternatives;

  // The SDK finds curves in the geometry only when a sectionTypes list names them.
  if (options.curves) params.sectionTypes = [...defaultSectionTypes, "curve", "curvyStretch"];

  return params;
}

export async function getRoute(
  locations: Position[],
  options?: RouteOptions,
  extras?: RouteExtras
): Promise<Routes> {
  const apiKey = requireApiKey();

  if (locations.length < 2) {
    throw new IncorrectError("At least two locations (origin and destination) are required", {
      location_count: locations.length,
      minimum_required: 2,
    });
  }

  logger.debug({ location_count: locations.length }, "Calculating route via SDK");

  return calculateRoute(buildSdkRouteParams(apiKey, locations, options, extras));
}
