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
import { whereSchema } from "../../tools/shared/inputs/resolve-where";
import { geometryResponseDetailSchema, uiVisibilityParam } from "../shared/responseOptions";
import { tomtomTrafficSchema } from "../traffic/trafficSchema";
import { routingOptionsSchema } from "./common";

export const tomtomPlanRouteSchema = {
  locations: z
    .array(locationInputSchema)
    .min(2)
    .describe(
      "Ordered [origin, ...stops, destination] — at least two. Each entry is a place NAME " +
        "({ query, queryAs }), explicit coordinates ({ position }), or a place you already found " +
        "coordinates. Naming places directly is the point: no separate geocode step."
    ),
  ...routingOptionsSchema,
  ...uiVisibilityParam,
};

export type PlanRouteParams = z.input<z.ZodObject<typeof tomtomPlanRouteSchema>>;

export const tomtomGetTrafficSchema = {
  where: whereSchema.describe(
    "The area to report traffic for. Use mode `within` and name the area in `queries` " +
      '(e.g. ["Amsterdam"]) — no separate geocode step. `boundingBox` works if you have exact ' +
      "bounds, and mode `nearby` covers a radius around a point."
  ),
  categoryFilter: tomtomTrafficSchema.categoryFilter,
  timeValidityFilter: tomtomTrafficSchema.timeValidityFilter,
  maxResults: tomtomTrafficSchema.maxResults,
  language: tomtomTrafficSchema.language,
  response_detail: geometryResponseDetailSchema,
  ...uiVisibilityParam,
};

export type GetTrafficParams = z.input<z.ZodObject<typeof tomtomGetTrafficSchema>>;
