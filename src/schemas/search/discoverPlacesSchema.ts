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
import { queryAsSchema } from "../../tools/shared/inputs/location-input";
import { POI_CATEGORIES_DOC } from "../../tools/shared/inputs/resolve-poi-categories";
import { whereSchema } from "../../tools/shared/inputs/resolve-where";
import { uiVisibilityParam } from "./common";

export const tomtomDiscoverPlacesSchema = {
  query: z
    .string()
    .optional()
    .describe(
      'Free-text filter on the place\'s NAME — a brand or a specific thing ("Starbucks", "pizza"). ' +
        "NEVER a city, region or area name: those go in `where`. " +
        'For "restaurants in Paris", `query` is empty (or a name filter) and `where.queries` is ["Paris"]. ' +
        "Omit entirely when filtering by category — use `poiCategories`."
    ),
  poiCategories: z.array(z.string()).optional().describe(POI_CATEGORIES_DOC),
  where: whereSchema.optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Maximum results (1-100, default 10). Raise it when the question is about the SET rather " +
        "than a few examples — the full result set is held server-side either way, and " +
        "tomtom-analyse-data can count or group it without returning it."
    ),
  language: z.string().optional().describe("IETF language tag for result names, e.g. 'nl-NL'."),
  countries: z
    .array(z.string())
    .optional()
    .describe("Restrict to ISO country codes, e.g. ['NL', 'BE']."),
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
  includeGeometry: z
    .boolean()
    .optional()
    .describe(
      "Return the place's BOUNDARY POLYGON where one exists (default false). Set true when you " +
        "need the shape — to draw it, or to pass its dataset_id as a `where.dataset_ids` scope for " +
        "a later search. This is the only tool that returns boundaries."
    ),
  ...uiVisibilityParam,
};

export type LocatePlaceParams = z.input<z.ZodObject<typeof tomtomLocatePlaceSchema>>;
