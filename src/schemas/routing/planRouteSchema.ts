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
 */

import { z } from "zod";
import { locationInputSchema } from "../../tools/shared/inputs/location-input";
import { areaWhereSchema } from "../../tools/shared/inputs/resolve-where";
import { geometryResponseDetailSchema, uiVisibilityParam } from "../shared/responseOptions";
import { tomtomTrafficSchema } from "../traffic/trafficSchema";
import { routingOptionsSchema } from "./common";

export const tomtomPlanRouteSchema = {
  locations: z
    .array(locationInputSchema)
    .min(2)
    .describe(
      "Ordered [origin, ...stops, destination] — at least two. Each entry is a place NAME " +
        "({ query, queryAs }) or explicit coordinates ({ position }), such as a place an earlier " +
        "search found. Name places directly: no separate geocode step."
    ),
  insertStops: z
    .array(locationInputSchema)
    .min(1)
    .max(10)
    .optional()
    .describe(
      "Stops to fit into the trip where each costs the least extra driving, in whatever order " +
        "suits the route: `locations` keeps its order and the stops are slotted between its " +
        "entries. The result's `waypoints` list the visiting order, each inserted stop marked."
    ),
  curves: z
    .boolean()
    .optional()
    .describe(
      "Analyse each route's curves: counts of curves, hairpins and hard curves, a curviness " +
        "score, and its curviest stretches with where they start and the road they are on. Set it " +
        "to keep a car-sick passenger off winding roads or to find twisty roads for a motorbike; " +
        "with alternatives, compare the routes on it."
    ),
  compareWithUsualRoute: z
    .boolean()
    .optional()
    .describe(
      "Also plan the route usual traffic would take and report how today's live route differs: " +
        "whether it takes other roads, and the jams and closures it goes around. Use it for " +
        '"why does it send me this way?" or "is traffic changing my route today?".'
    ),
  checkpoints: z
    .array(
      z.union([
        z.object({
          afterMinutes: z.number().positive().describe("Minutes driven from the start."),
        }),
        z.object({
          afterKilometers: z.number().positive().describe("Kilometres driven from the start."),
        }),
      ])
    )
    .min(1)
    .max(10)
    .optional()
    .describe(
      "Points along the first route by driving time or distance, each reported with its " +
        'position and the town it is near, for "where will I be after 3 hours?".'
    ),
  ...routingOptionsSchema,
  ...uiVisibilityParam,
};

export type PlanRouteParams = z.input<z.ZodObject<typeof tomtomPlanRouteSchema>>;

export const tomtomGetTrafficSchema = {
  where: areaWhereSchema.describe(
    "The area to report traffic for. Use mode `within` and name the city, district or " +
      'neighbourhood in `queries` (e.g. ["Amsterdam"]): incidents are confined to its boundary. ' +
      "`boundingBox` works if you have exact bounds, and mode `nearby` covers a radius around a point."
  ),
  categoryFilter: tomtomTrafficSchema.categoryFilter,
  timeValidityFilter: tomtomTrafficSchema.timeValidityFilter,
  maxResults: tomtomTrafficSchema.maxResults,
  language: tomtomTrafficSchema.language,
  response_detail: geometryResponseDetailSchema,
  ...uiVisibilityParam,
};

export type GetTrafficParams = z.input<z.ZodObject<typeof tomtomGetTrafficSchema>>;
