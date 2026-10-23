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
import { uiVisibilityParam } from "../shared/responseOptions";
import {
  baseSearchParams,
  boundingBoxParams,
  GEOGRAPHY_TYPES_HINT,
  locationBiasParams,
  poiFilterParams,
  timeZoneParams,
} from "./common";

export const tomtomFuzzySearchSchema = {
  query: z
    .string()
    .describe(
      "Natural language search query. Works with addresses, POI names, coordinates, or free-form text. Examples: 'restaurants near Central Park', 'IKEA stores', '52.3791,4.8994', 'coffee shops downtown'"
    ),
  ...uiVisibilityParam,
  ...baseSearchParams,
  ...timeZoneParams,
  ...locationBiasParams,
  ...boundingBoxParams,
  ...poiFilterParams,
  typeahead: z
    .boolean()
    .optional()
    .describe(
      "Enable autocomplete mode for partial queries. Use for search-as-you-type interfaces."
    ),
  radius: z
    .number()
    .optional()
    .describe(
      "Search radius in meters around position; needs position. Examples: 1000 (neighborhood), 5000 (city area), 20000 (metro area)."
    ),
  maxFuzzyLevel: z.literal([1, 2, 3, 4]).optional().describe("Maximum fuzzy matching level"),
  minFuzzyLevel: z.literal([1, 2, 3, 4]).optional().describe("Minimum fuzzy matching level"),
  entityTypeSet: z
    .string()
    .optional()
    .describe(
      `Filter results by geographic entity types, ${GEOGRAPHY_TYPES_HINT}. Note: This parameter is for geographic entities only, not POIs. For POI filtering, use poiCategories instead`
    ),
  idxSet: z
    .string()
    .optional()
    .describe(
      "Search only these indexes, comma-separated: 'Geo' (geographies), 'PAD' (point addresses), 'Addr' (address ranges), 'Str' (streets), 'XStr' (cross streets), 'POI'."
    ),
  relatedPois: z
    .string()
    .optional()
    .describe(
      "Include related points of interest: 'off', 'child', 'parent' or 'all'. Default: 'off'."
    ),
  poiCategories: z
    .array(z.string())
    .max(10)
    .optional()
    .describe(
      "Filter POI results by UPPER_SNAKE_CASE text category codes (e.g. 'RESTAURANT', 'PARKING_GARAGE'), NOT numeric IDs. IMPORTANT: Never guess codes — always call tomtom-poi-categories first with the user's intent as keywords to discover valid codes."
    ),
};

export const tomtomPOISearchSchema = {
  query: z
    .string()
    .describe(
      "Name of the POI to search for. If the intended query is a POI category like 'restaurant', provide an empty string for this param and use the category filter parameter to apply the desired category filter."
    ),
  ...uiVisibilityParam,
  ...baseSearchParams,
  ...timeZoneParams,
  ...locationBiasParams,
  ...boundingBoxParams,
  ...poiFilterParams,
  radius: z
    .number()
    .optional()
    .describe(
      "Search radius in meters around position; needs position. Examples: 1000 (walking), 5000 (driving), 20000 (wide area)."
    ),
  typeahead: z
    .boolean()
    .optional()
    .describe("Autocomplete mode for partial queries. Use for search interfaces."),
  relatedPois: z
    .string()
    .optional()
    .describe(
      "Include related points of interest: 'off', 'child', 'parent' or 'all'. Default: 'off'."
    ),
  poiCategories: z
    .array(z.string())
    .max(10)
    .optional()
    .describe(
      "Filter POI results by UPPER_SNAKE_CASE text category codes (e.g. 'RESTAURANT', 'PARKING_GARAGE'), NOT numeric IDs. IMPORTANT: Never guess codes — always call tomtom-poi-categories first with the user's intent as keywords to discover valid codes."
    ),
};

export const tomtomGeocodeSearchSchema = {
  query: z
    .string()
    .describe(
      "Full address to convert to coordinates. Include as much detail as possible (street, city, country) for accurate results. Examples: '1600 Pennsylvania Ave, Washington DC', 'Eiffel Tower, Paris, France'"
    ),
  ...uiVisibilityParam,
  ...baseSearchParams,
  ...locationBiasParams,
  ...boundingBoxParams,
  entityTypeSet: z
    .string()
    .optional()
    .describe(
      `Filter results by geographic entity types, ${GEOGRAPHY_TYPES_HINT}. Note: This parameter is for geographic entities only, not POIs. For POI filtering, use poiCategories instead`
    ),
};

export const tomtomReverseGeocodeSearchSchema = {
  position: z
    .array(z.number())
    .length(2)
    .describe(
      "Position as [longitude, latitude] to reverse geocode (GeoJSON convention). " +
        "Precision to 4+ decimal places recommended. Example: [4.89707, 52.377956]."
    ),
  ...uiVisibilityParam,
  response_detail: baseSearchParams.response_detail,
  language: baseSearchParams.language,
  view: baseSearchParams.view,
  radius: z.number().optional().describe("Search radius in meters. Default: 100"),
  heading: z
    .number()
    .optional()
    .describe("Heading direction in degrees (0-360) for improved accuracy on roads"),
  entityType: z
    .string()
    .optional()
    .describe(
      `Filter by geography entity types, ${GEOGRAPHY_TYPES_HINT}. Not with heading, which the API then ignores.`
    ),
};

export const tomtomPOICategoriesSchema = {
  filters: z
    .array(z.string())
    .optional()
    .describe(
      "Keywords to find categories by name or synonym, accents ignored. Each keyword returns its best-matching categories, so 'bar' finds Bar and not Nail Salon; with several keywords, each one's best match comes first. " +
        "Examples: ['gym'], ['italian restaurant'], ['parking', 'garage']. " +
        "Omit to return all available POI categories."
    ),
};

// ---------------------------------------------------------------------------
// Area / Geometry Search
// ---------------------------------------------------------------------------

export type FuzzySearchParams = z.input<z.ZodObject<typeof tomtomFuzzySearchSchema>>;
export type PoiSearchParams = z.input<z.ZodObject<typeof tomtomPOISearchSchema>>;
export type GeocodeSearchParams = z.input<z.ZodObject<typeof tomtomGeocodeSearchSchema>>;
export type ReverseGeocodeSearchParams = z.infer<
  z.ZodObject<typeof tomtomReverseGeocodeSearchSchema>
>;
export type PoiCategoriesParams = z.input<z.ZodObject<typeof tomtomPOICategoriesSchema>>;
