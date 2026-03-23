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
import {
  baseSearchParams,
  locationBiasParams,
  boundingBoxParams,
  poiFilterParams,
  uiVisibilityParam,
} from "./commonOrbis";

export const tomtomFuzzySearchSchema = {
  query: z
    .string()
    .describe(
      "Natural language search query. Works with addresses, POI names, coordinates, or free-form text. Examples: 'restaurants near Central Park', 'IKEA stores', '52.3791,4.8994', 'coffee shops downtown'"
    ),
  ...uiVisibilityParam,
  ...baseSearchParams,
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
      "Search radius in meters when lat/lon provided. Examples: 1000 (neighborhood), 5000 (city area), 20000 (metro area)."
    ),
  maxFuzzyLevel: z.number().optional().describe("Maximum fuzzy matching level (1-4)"),
  minFuzzyLevel: z.number().optional().describe("Minimum fuzzy matching level (1-4)"),
  entityTypeSet: z.string().optional()
    .describe(`Filter results by geographic entity types. Valid values: PostalCodeArea,
      CountryTertiarySubdivision, CountrySecondarySubdivision, MunicipalitySubdivision,
      MunicipalitySecondarySubdivision, Country, CountrySubdivision, Neighbourhood, Municipality.
      Note: This parameter is for geographic entities only, not POIs.
      For POI filtering, use poiCategories instead`),
  ofs: z.number().optional().describe("Offset for pagination of results"),
  idxSet: z.string().optional().describe("Filter results by index set"),
  relatedPois: z.string().optional().describe("Include related points of interest"),
  ext: z.string().optional().describe("Extended parameters for the search"),
  poiCategories: z
    .array(z.string())
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
  ...locationBiasParams,
  ...boundingBoxParams,
  ...poiFilterParams,
  radius: z
    .number()
    .optional()
    .describe(
      "Search radius in meters. Essential for focused local results. Examples: 1000 (walking), 5000 (driving), 20000 (wide area)."
    ),
  typeahead: z
    .boolean()
    .optional()
    .describe("Autocomplete mode for partial queries. Use for search interfaces."),
  chargingAvailability: z
    .boolean()
    .optional()
    .describe("Include charging availability information for EV stations"),
  ofs: z.number().optional().describe("Offset for pagination of results"),
  relatedPois: z.string().optional().describe("Include related points of interest"),
  ext: z.string().optional().describe("Extended parameters for the search"),
  poiCategories: z
    .array(z.string())
    .optional()
    .describe(
      "Filter POI results by UPPER_SNAKE_CASE text category codes (e.g. 'RESTAURANT', 'PARKING_GARAGE'), NOT numeric IDs. IMPORTANT: Never guess codes — always call tomtom-poi-categories first with the user's intent as keywords to discover valid codes."
    ),
};

export const tomtomNearbySearchSchema = {
  position: z
    .tuple([z.number(), z.number()])
    .describe(
      "Center position as [longitude, latitude] for nearby search (GeoJSON convention). " +
        "Example: [4.89707, 52.377956] for Amsterdam. Use precise coordinates from geocoding."
    ),
  ...uiVisibilityParam,
  ...baseSearchParams,
  ...poiFilterParams,
  radius: z
    .number()
    .optional()
    .describe(
      "Search radius in meters. Default: 1000. Recommended: 500 (walking), 1000 (local), 5000 (driving), 20000 (wide area)."
    ),
  poiCategories: z
    .array(z.string())
    .optional()
    .describe(
      "Filter POI results by UPPER_SNAKE_CASE text category codes (e.g. 'RESTAURANT', 'PARKING_GARAGE'), NOT numeric IDs. IMPORTANT: Never guess codes — always call tomtom-poi-categories first with the user's intent as keywords to discover valid codes."
    ),
  parkingAvailability: z.boolean().optional().describe("Include parking availability information"),
  ofs: z.number().optional().describe("Offset for pagination of results"),
  relatedPois: z.string().optional().describe("Include related points of interest"),
  ext: z.string().optional().describe("Extended parameters for the search"),
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
      "Filter results by geographic entity types. Valid values: PostalCodeArea, CountryTertiarySubdivision, CountrySecondarySubdivision, MunicipalitySubdivision, MunicipalitySecondarySubdivision, Country, CountrySubdivision, Neighbourhood, Municipality. Note: This parameter is for geographic entities only, not POIs. For POI filtering, use poiCategories instead"
    ),
  ofs: z.number().optional().describe("Offset for pagination of results"),
};

export const tomtomReverseGeocodeSearchSchema = {
  position: z
    .tuple([z.number(), z.number()])
    .describe(
      "Position as [longitude, latitude] to reverse geocode (GeoJSON convention). " +
        "Precision to 4+ decimal places recommended. Example: [4.89707, 52.377956]."
    ),
  ...uiVisibilityParam,
  ...baseSearchParams,
  radius: z.number().optional().describe("Search radius in meters. Default: 100"),
  returnMatchType: z
    .boolean()
    .optional()
    .describe("Include information about the type of geocoding match achieved"),
  returnSpeedLimit: z
    .boolean()
    .optional()
    .describe("Include posted speed limit for street results"),
  allowFreeformNewLine: z.boolean().optional().describe("Allow newlines in freeform addresses"),
  heading: z
    .number()
    .optional()
    .describe("Heading direction in degrees (0-360) for improved accuracy on roads"),
  returnRoadClass: z
    .string()
    .optional()
    .describe(
      "Enable return of roadClass array for street-level results. Value: 'Functional' (road classification based on network importance)"
    ),
  entityType: z
    .string()
    .optional()
    .describe(
      "Filter by geography entity types. Available: Country, CountrySubdivision, CountrySecondarySubdivision, CountryTertiarySubdivision, Municipality, MunicipalitySubdivision, MunicipalitySecondarySubdivision, Neighbourhood, PostalCodeArea. When set, heading/returnRoadClass/returnSpeedLimit/returnMatchType are ignored."
    ),
  callback: z
    .string()
    .optional()
    .describe("Callback method name for JSONP responses. Default: 'cb'"),
  filter: z
    .string()
    .optional()
    .describe(
      "Exclude address-carrying elements for closest match. Value: 'BackRoads' (excludes unofficial roads, paths, tracks for more accurate addressing)"
    ),
};

export const tomtomPOICategoriesSchema = {
  filters: z
    .array(z.string())
    .optional()
    .describe(
      "Keywords to filter categories by name or synonym. Each keyword is matched as a substring against category names. " +
        "Results from all keywords are merged and deduplicated. " +
        "Examples: ['gym'], ['italian restaurant'], ['parking', 'garage']. " +
        "Omit to return all available POI categories."
    ),
};
