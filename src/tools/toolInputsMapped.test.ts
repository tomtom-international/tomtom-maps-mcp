/*
 * Copyright (C) 2026 TomTom Navigation B.V.
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

import { describe, expectTypeOf, it } from "vitest";
import type { DynamicMapParams } from "../schemas/map/dynamicMapSchema";
import type { GetTrafficParams, PlanRouteParams } from "../schemas/routing/planRouteSchema";
import type { ReverseGeocodeSearchParams } from "../schemas/search/searchSchema";
import type { RouteOptions } from "../services/routing/routingService";
import type { ReverseGeocodeOptions } from "../services/search/searchService";
import type { TrafficIncidentsOptions } from "../services/traffic/types";

// Each service's options type lists the tool inputs it maps to SDK parameters,
// and the SDK parameter types check those mappings. These assertions close the
// other side: a tool input that is in neither the options nor the handler's own
// list fails `pnpm type-check`, so a new schema key cannot be dropped silently.
// toolInputsReachApi.test.ts then checks at runtime that each mapping reaches
// the request. tomtom-discover-places and tomtom-locate-place pick a service
// per scope inside the handler, so only that runtime check covers them.

/** Inputs every handler consumes itself: they shape the tool result. */
type HandlerInput = "show_ui" | "response_detail";

/** The tool inputs neither the service options nor the handler take: must be never. */
type Unmapped<Schema, Options, Handled extends PropertyKey = never> = Exclude<
  keyof Schema,
  keyof Options | HandlerInput | Handled
>;

describe("every tool input is mapped", () => {
  it("reverse geocode", () => {
    expectTypeOf<
      Unmapped<ReverseGeocodeSearchParams, ReverseGeocodeOptions, "position">
    >().toBeNever();
  });

  it("plan route", () => {
    expectTypeOf<Unmapped<PlanRouteParams, RouteOptions, "locations">>().toBeNever();
  });

  it("dynamic-map route plans", () => {
    type RoutePlan = NonNullable<DynamicMapParams["routePlans"]>[number];
    type Drawn = "origin" | "destination" | "waypoints" | "label" | "color";
    expectTypeOf<Unmapped<RoutePlan, RouteOptions, Drawn>>().toBeNever();
  });

  it("traffic", () => {
    expectTypeOf<
      Unmapped<GetTrafficParams, TrafficIncidentsOptions, "where" | "maxResults">
    >().toBeNever();
  });
});
