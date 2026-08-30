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
 * Routing tool executors. Replaces `handlers/routingHandler.ts`; the EV-routing
 * projection moved to `shared/response-trimmer.ts` with the other trimmers.
 */

import type {
  EvRoutingParams,
  ReachableRangeParams,
  RoutingParams,
} from "../../schemas/routing/routingSchema";
import {
  calculateEVRoute,
  getReachableRange,
  getRoute,
} from "../../services/routing/routingService";
import { defineDataTool } from "../shared/define-data-tool";
import {
  trimEVRoutingResponse,
  trimReachableRangeResponse,
  trimRoutingResponse,
} from "../shared/response-trimmer";

export const routingHandler = defineDataTool<RoutingParams, unknown>({
  verb: "Route calculation",
  name: "tomtom-routing",
  kind: "routes",
  execute: (routingParams) =>
    getRoute(routingParams.locations, routingParams as Parameters<typeof getRoute>[1]),
  project: trimRoutingResponse,
  logResult: (result) => ({
    route_count: (result as { features?: unknown[] })?.features?.length ?? 0,
  }),
});

/** Budget fields — at least one is required for a reachable-range request. */
const BUDGET_FIELDS = [
  "timeBudgetInSec",
  "distanceBudgetInMeters",
  "chargeBudgetPercent",
  "remainingChargeBudgetPercent",
  "energyBudgetInkWh",
  "fuelBudgetInLiters",
] as const;

export const reachableRangeHandler = defineDataTool<ReachableRangeParams, unknown>({
  verb: "Reachable range",
  name: "tomtom-reachable-range",
  kind: "ranges",
  validate: (rangeParams) =>
    BUDGET_FIELDS.some((field) => (rangeParams as Record<string, unknown>)[field])
      ? undefined
      : "Error: At least one budget parameter (time, distance, energy, or fuel) must be provided",
  // `origin` is passed BOTH positionally and inside the options object — the
  // service reads range fields off the same object it was given.
  execute: (rangeParams) =>
    getReachableRange(rangeParams.origin, rangeParams as Parameters<typeof getReachableRange>[1]),
  project: trimReachableRangeResponse,
});

export const evRoutingHandler = defineDataTool<EvRoutingParams, unknown>({
  verb: "EV route calculation",
  name: "tomtom-ev-routing",
  kind: "routes",
  execute: (routeParams) => calculateEVRoute(routeParams as Parameters<typeof calculateEVRoute>[0]),
  project: (result) =>
    trimEVRoutingResponse(result as { features?: Array<Record<string, unknown>> }),
  logResult: (result) => ({
    route_count: (result as { features?: unknown[] })?.features?.length ?? 0,
  }),
});
