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

import {
  trafficIncidentRequestCategories,
  trafficIncidentTimeValidities,
} from "@tomtom-org/maps-sdk/core";
import { z } from "zod";
import { locationInputSchema } from "../../tools/shared/inputs/location-input";
import {
  modeBranch,
  modeUnion,
  nearbyWhereSchema,
  WHERE_DOC,
  withinWhereSchema,
} from "../../tools/shared/inputs/resolve-where";
import { geometryResponseDetailSchema, uiVisibilityParam } from "../shared/responseOptions";

export const DEFAULT_CORRIDOR_METERS = 1000;
const MAX_CORRIDOR_METERS = 5000;

/** `alongRoute` — a corridor either side of a driving route. */
const alongRouteWhereSchema = modeBranch("alongRoute", {
  locations: z
    .array(locationInputSchema)
    .min(2)
    .describe(
      "The trip: ordered [origin, ...stops, destination], each a place name ({ query, queryAs }) " +
        "or { position }. The driving route is planned for you: no tomtom-plan-route call first."
    ),
  withinMeters: z
    .number()
    .positive()
    .max(MAX_CORRIDOR_METERS)
    .optional()
    .describe(
      `How far either side of the route to report incidents, in metres (default ${DEFAULT_CORRIDOR_METERS}, ` +
        `at most ${MAX_CORRIDOR_METERS}). Covers both directions and the roads alongside.`
    ),
});

const trafficWhereSchema = modeUnion([withinWhereSchema, nearbyWhereSchema, alongRouteWhereSchema]);

export type AlongRouteWhere = z.infer<typeof alongRouteWhereSchema>;

export const tomtomGetTrafficSchema = {
  where: trafficWhereSchema.describe(
    `${WHERE_DOC}\`alongRoute\` — a corridor \`withinMeters\` either side of the drive between ` +
      "`locations`, for incidents near a route however long. For a city, district or " +
      'neighbourhood, use mode `within` and name it in `queries` (e.g. ["Amsterdam"]): incidents ' +
      "are confined to its boundary."
  ),

  categoryFilter: z
    .array(z.enum(trafficIncidentRequestCategories))
    .optional()
    .describe("Incident categories to return. Default: all categories."),

  timeValidityFilter: z
    .array(z.enum(trafficIncidentTimeValidities))
    .optional()
    .describe(
      "Which incidents to return by time: 'present' (happening now), 'future' (planned, e.g. road works). Default: ['present']."
    ),

  maxResults: z
    .number()
    .min(1)
    .max(1000)
    .optional()
    .describe(
      "Maximum number of incidents to return (1-1000). Default: 100. When more match, the most " +
        "severe are returned. Either way `incidentSummary` covers every incident found: the total, " +
        "the total delay, and counts by category, magnitude and road number. Read totals and " +
        "per-road questions there rather than raising this."
    ),

  language: z
    .string()
    .optional()
    .describe(
      "Language for incident descriptions: 'en-GB', 'de-DE', 'fr-FR', 'es-ES'. Default: 'en-GB'."
    ),

  response_detail: geometryResponseDetailSchema,
  ...uiVisibilityParam,
};

export type GetTrafficParams = z.input<z.ZodObject<typeof tomtomGetTrafficSchema>>;
