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
 * What the server cannot do, for reviewers deciding whether "I can't" was the right answer.
 * Each entry names where the limit lives; re-check them when the tools change.
 */

import { MAX_LIMIT } from "../../src/schemas/search/discoverPlacesSchema";

export const SERVER_LIMITS: readonly { limit: string; source: string }[] = [
  {
    limit: "Routes are by car only: no cycling, walking, truck or public transport routes.",
    source: "travelMode in src/schemas/routing/common.ts",
  },
  {
    limit:
      "Routes take no vehicle size or weight, so none is checked for low bridges or weight limits.",
    source: "src/schemas/routing/common.ts",
  },
  {
    limit: "Nothing computes the area reachable within a time or distance.",
    source: "tomtom-reachable-range, retired in src/tools/retiredTools.ts",
  },
  {
    limit:
      "No live availability: search finds chargers and car parks, but not which are free right now.",
    source: "the search tools",
  },
  {
    limit:
      "Traffic covers current and planned incidents only: no past traffic and no forecast. A route " +
      "with a departure time and historical traffic gives a typical travel time, not a forecast.",
    source:
      "timeValidityFilter in src/schemas/traffic/trafficSchema.ts; traffic in routing/common.ts",
  },
  {
    limit: "No weather or forecasts; traffic incidents include current weather hazards only.",
    source: "no tool offers them; categoryFilter in src/schemas/traffic/trafficSchema.ts",
  },
  {
    limit: "No timetables, bookings or reservations of any kind.",
    source: "no tool offers them",
  },
  {
    limit:
      "No prices or costs: no toll charges, fuel prices or parking fees. A route gives how far it " +
      "runs on toll roads, not what they cost.",
    source: "tollRoadLengthInMeters in src/tools/shared/route-analysis.ts",
  },
  {
    limit:
      "No fuel or energy use: nothing works out consumption or battery left, since routes take " +
      "no vehicle.",
    source:
      "src/schemas/routing/common.ts; tomtom-ev-routing, retired in src/tools/retiredTools.ts",
  },
  {
    limit: "No elevation: routes report curves and hairpins, not climbs, gradients or altitudes.",
    source: "curves in src/schemas/routing/planRouteSchema.ts",
  },
  {
    limit: "No speed cameras; routes give the distance at each speed limit.",
    source: "speedLimits in src/tools/shared/route-analysis.ts",
  },
  {
    limit:
      "No vehicle rules: whether a vehicle may enter a low-emission zone, or needs a vignette. A " +
      "route reports low-emission zones and can avoid them.",
    source: "avoid in src/schemas/routing/common.ts",
  },
  {
    limit:
      "Places come with name, address, categories, brands, phone, opening hours and chargers " +
      "only: no ratings, reviews, prices, accessibility, photos or how busy they are.",
    source: "response_detail in src/schemas/search/discoverPlacesSchema.ts",
  },
  {
    limit: "No statistics about an area, such as its population.",
    source: "no tool offers them",
  },
  {
    limit:
      `Search returns at most ${MAX_LIMIT} places per call; a capped result says so, and a count ` +
      "over it covers only what came back.",
    source: "limit in src/schemas/search/discoverPlacesSchema.ts",
  },
];
