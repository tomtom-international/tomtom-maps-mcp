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

import { connectorTypes } from "@tomtom-org/maps-sdk/core";
import { z } from "zod";
import { locationInputSchema } from "../../tools/shared/inputs/location-input";
import { POI_CATEGORIES_DOC } from "../../tools/shared/inputs/resolve-poi-categories";
import {
  globalWhereSchema,
  modeBranch,
  modeUnion,
  nearbyWhereSchema,
  WHERE_DOC,
  whereSchema,
  withinWhereSchema,
} from "../../tools/shared/inputs/resolve-where";
import {
  geometryResponseDetailSchema,
  responseDetailSchema,
  uiVisibilityParam,
} from "../shared/responseOptions";

/** The Along Route Search API's largest detour, and most results. */
const MAX_DETOUR_TIME_SECONDS = 3600;
export const MAX_ALONG_ROUTE_RESULTS = 20;

/** `maxDetour` — places along a driving route, in the order `sortBy` names. */
const maxDetourWhereSchema = modeBranch("maxDetour", {
  locations: z
    .array(locationInputSchema)
    .min(2)
    .describe(
      "The trip to search along: ordered [origin, ...stops, destination], each a place name " +
        '({ query }) or { position }. Every stop the user names goes in — "via Antwerp" ' +
        "is a location. The driving route is planned for you: no tomtom-plan-route call first."
    ),
  maxDetourTimeSeconds: z
    .number()
    .int()
    .positive()
    .max(MAX_DETOUR_TIME_SECONDS)
    .describe(
      `Most extra driving time, in whole seconds, a stop may add to the trip (at most ${MAX_DETOUR_TIME_SECONDS}).`
    ),
  sortBy: z
    .enum(["detourOffset", "detourTime"])
    .describe(
      '"detourOffset" lists stops in the order the drive reaches them, for "the first ones I ' +
        'pass" or "on the way"; "detourTime" ranks them by the extra time each adds, for "the ' +
        'quickest stop". Every stop carries its `detourTimeInSeconds` either way.'
    ),
});

const discoverWhereSchema = modeUnion([
  withinWhereSchema,
  nearbyWhereSchema,
  maxDetourWhereSchema,
  globalWhereSchema,
]).describe(
  WHERE_DOC +
    "`maxDetour` — stops along a drive between `locations`, each within " +
    "`maxDetourTimeSeconds` of extra driving, in the order `sortBy` names; at most " +
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
        'here alongside the category: "Albert Heijn supermarkets" is query "Albert Heijn". ' +
        'With neither, a scoped search browses the commonest kinds of place ("what is around here").'
    ),
  poiCategories: z.array(z.string()).max(10).optional().describe(POI_CATEGORIES_DOC),
  where: discoverWhereSchema.optional(),
  minPowerKW: z
    .number()
    .positive()
    .optional()
    .describe(
      "EV charging only: keep stations with a charger of at least this power, in kilowatts " +
        '("22 kW and faster" is 22). The search drops the rest, so the results and their ' +
        "`summary` need no filtering after."
    ),
  maxPowerKW: z
    .number()
    .positive()
    .optional()
    .describe(
      "EV charging only: keep stations with a charger of at most this power, in kilowatts."
    ),
  connectors: z
    .array(z.enum(connectorTypes))
    .max(10)
    .optional()
    .describe(
      "EV charging only: keep stations with at least one of these connector types, e.g. " +
        '["IEC62196Type2CCS"] for CCS or ["Chademo"].'
    ),
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
      "Restrict to ISO 3166-1 alpha-2 country codes, e.g. ['NL', 'BE']. Modes `within` and " +
        "`maxDetour` ignore it: an area or a route already says where."
    ),
  response_detail: responseDetailSchema.describe(
    "Response detail level. 'compact' (default) has each place's name, address, categories, " +
      "brands, phone, opening hours and chargers, and `summary` counts them by category: answer " +
      "breakdowns from it. 'full' adds only raw API fields, such as localized category names, " +
      "at many times the size."
  ),
  ...uiVisibilityParam,
};

export type DiscoverPlacesParams = z.input<z.ZodObject<typeof tomtomDiscoverPlacesSchema>>;

export const tomtomLocatePlaceSchema = {
  query: z
    .string()
    .describe(
      "The place to locate — a single named place, address or landmark. Say where in the query " +
        'itself when several places share the name: "Dam Square, Amsterdam".'
    ),
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
