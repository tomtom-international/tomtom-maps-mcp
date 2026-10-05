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
import type {
  EvRoutingParams,
  ReachableRangeParams,
  RoutingParams,
} from "../schemas/routing/routingSchema";
import type * as SearchSchema from "../schemas/search/searchSchema";
import type { TrafficParams } from "../schemas/traffic/trafficSchema";
import type { EVRoutingOptions, RouteOptions } from "../services/routing/routingService";
import type { ReachableRangeOptions } from "../services/routing/types";
import type {
  AreaSearchOptions,
  EVSearchOptions,
  FuzzySearchOptions,
  GeocodeOptions,
  NearbySearchOptions,
  PoiSearchOptions,
  ReverseGeocodeOptions,
  SearchAlongRouteOptions,
} from "../services/search/searchService";
import type { TrafficIncidentsOptions } from "../services/traffic/types";

// Each service's options type lists the tool inputs it maps to SDK parameters,
// and the SDK parameter types check those mappings. These assertions close the
// other side: a tool input that is in neither the options nor the handler's own
// list fails `pnpm type-check`, so a new schema key cannot be dropped silently.
// toolInputsReachApi.test.ts then checks at runtime that each mapping reaches
// the request.

/** Inputs every handler consumes itself: they shape the tool result. */
type HandlerInput = "show_ui" | "response_detail";

/** The tool inputs neither the service options nor the handler take: must be never. */
type Unmapped<Schema, Options, Handled extends PropertyKey = never> = Exclude<
  keyof Schema,
  keyof Options | HandlerInput | Handled
>;

describe("every tool input is mapped", () => {
  it("search tools", () => {
    expectTypeOf<Unmapped<SearchSchema.GeocodeSearchParams, GeocodeOptions, "query">>().toBeNever();
    expectTypeOf<
      Unmapped<SearchSchema.ReverseGeocodeSearchParams, ReverseGeocodeOptions, "position">
    >().toBeNever();
    expectTypeOf<
      Unmapped<SearchSchema.FuzzySearchParams, FuzzySearchOptions, "query">
    >().toBeNever();
    expectTypeOf<Unmapped<SearchSchema.PoiSearchParams, PoiSearchOptions, "query">>().toBeNever();
    expectTypeOf<
      Unmapped<SearchSchema.NearbySearchParams, NearbySearchOptions, "position">
    >().toBeNever();
    expectTypeOf<Unmapped<SearchSchema.AreaSearchParams, AreaSearchOptions>>().toBeNever();
    expectTypeOf<Unmapped<SearchSchema.EvSearchParams, EVSearchOptions>>().toBeNever();
    expectTypeOf<
      Unmapped<SearchSchema.SearchAlongRouteParams, SearchAlongRouteOptions>
    >().toBeNever();
  });

  it("routing tools", () => {
    expectTypeOf<Unmapped<RoutingParams, RouteOptions, "locations">>().toBeNever();
    expectTypeOf<Unmapped<ReachableRangeParams, ReachableRangeOptions, "origin">>().toBeNever();
    expectTypeOf<Unmapped<EvRoutingParams, EVRoutingOptions>>().toBeNever();
  });

  it("traffic", () => {
    expectTypeOf<Unmapped<TrafficParams, TrafficIncidentsOptions, "bbox">>().toBeNever();
  });
});
