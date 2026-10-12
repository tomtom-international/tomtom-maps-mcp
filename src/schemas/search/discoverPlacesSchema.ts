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
import { locationInputSchema, queryAsSchema } from "../../tools/shared/inputs/location-input";
import { POI_CATEGORIES_DOC } from "../../tools/shared/inputs/resolve-poi-categories";
import {
  globalWhereSchema,
  nearbyWhereSchema,
  whereSchema,
  withinWhereSchema,
} from "../../tools/shared/inputs/resolve-where";
import {
  geometryResponseDetailSchema,
  responseDetailSchema,
  uiVisibilityParam,
} from "../shared/responseOptions";

/** The Along Route Search API's largest detour, and most results. */
export const MAX_DETOUR_TIME_SECONDS = 3600;
export const MAX_ALONG_ROUTE_RESULTS = 20;

/** `maxDetour` — places along a driving route, ranked by the detour each one costs. */
const maxDetourWhereSchema = z.object({
  mode: z.literal("maxDetour"),
  locations: z
    .array(locationInputSchema)
    .min(2)
    .describe(
      "The trip to search along: ordered [origin, ...stops, destination], each a place name " +
        '({ query, queryAs }) or { position }. Every stop the user names goes in — "via Antwerp" ' +
        "is a location. The driving route is planned for you: no tomtom-plan-route call first."
    ),
  maxDetourTimeSeconds: z
    .number()
    .positive()
    .max(MAX_DETOUR_TIME_SECONDS)
    .describe(
      `Most extra driving time, in seconds, a stop may add to the trip (at most ${MAX_DETOUR_TIME_SECONDS}).`
    ),
  sortBy: z
    .enum(["detourTime", "detourOffset"])
    .optional()
    .describe(
      '"detourTime" (default) ranks by the extra time a stop adds; "detourOffset" orders by ' +
        "where the stop is along the route, from the start."
    ),
});

const discoverWhereSchema = z
  .union([withinWhereSchema, nearbyWhereSchema, maxDetourWhereSchema, globalWhereSchema])
  .describe(
    "Geographic scope, selected by `mode`. " +
      "`within` — an AREA: any combination of `queries` (city, district or neighbourhood names → " +
      "boundary polygons), `boundingBox` or `geometries`; all supplied fields are unioned. " +
      "`nearby` — a POINT bias with `radiusMeters`, given as `position` or `query`. " +
      "`maxDetour` — stops along a drive between `locations`, each within " +
      "`maxDetourTimeSeconds` of extra driving, ranked by that detour; at most " +
      `${MAX_ALONG_ROUTE_RESULTS} results. ` +
      "`global` — no constraint. Default when omitted: `global`."
  );

export type DiscoverWhere = z.infer<typeof discoverWhereSchema>;
export type MaxDetourWhere = z.infer<typeof maxDetourWhereSchema>;

export const tomtomDiscoverPlacesSchema = {
  query: z
    .string()
    .optional()
    .describe(
      'Free-text filter on the place\'s NAME — a brand or a specific thing ("Starbucks", "pizza"). ' +
        "NEVER a city, region or area name: those go in `where`. " +
        'For "restaurants in Paris", `query` is empty (or a name filter) and `where.queries` is ["Paris"]. ' +
        "Omit it when a category alone says what is wanted (`poiCategories`); a brand or chain stays " +
        'here alongside the category: "Albert Heijn supermarkets" is query "Albert Heijn".'
    ),
  poiCategories: z.array(z.string()).optional().describe(POI_CATEGORIES_DOC),
  where: discoverWhereSchema.optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Maximum results (1-100, default 10; mode `maxDetour` returns at most " +
        `${MAX_ALONG_ROUTE_RESULTS}). Raise it when the question is about the SET rather than a ` +
        "few examples. Results stop at the limit, so a count or breakdown over them covers only " +
        "what came back: narrow the search instead."
    ),
  language: z.string().optional().describe("IETF language tag for result names, e.g. 'nl-NL'."),
  countries: z
    .array(z.string())
    .optional()
    .describe(
      "Restrict to ISO country codes, e.g. ['NL', 'BE']. Modes `nearby` and `global` only: an " +
        "area or a route already says where."
    ),
  response_detail: responseDetailSchema,
  ...uiVisibilityParam,
};

export type DiscoverPlacesParams = z.input<z.ZodObject<typeof tomtomDiscoverPlacesSchema>>;

export const tomtomLocatePlaceSchema = {
  query: z.string().describe("The place to locate — a single named place, address or landmark."),
  queryAs: queryAsSchema,
  where: whereSchema
    .optional()
    .describe(
      "Optional scope. OMIT for a uniquely-named place anywhere (the default, and correct for " +
        "landmarks, cities and airports). Use `nearby` to disambiguate same-named places, or " +
        "`within` to hard-restrict to a known area."
    ),
  response_detail: geometryResponseDetailSchema.describe(
    `${geometryResponseDetailSchema.description} With 'geometry', a city, district or ` +
      "neighbourhood comes with its BOUNDARY POLYGON; a place without one comes with its point."
  ),
  ...uiVisibilityParam,
};

export type LocatePlaceParams = z.input<z.ZodObject<typeof tomtomLocatePlaceSchema>>;
