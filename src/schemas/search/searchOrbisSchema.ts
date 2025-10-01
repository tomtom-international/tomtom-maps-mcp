/*
 * Copyright (C) 2025 TomTom NV
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
} from "./commonOrbis";

export const tomtomFuzzySearchSchema = {
  query: z
    .string()
    .describe(
      "Natural language search query. Works with addresses, POI names, coordinates, or free-form text. Examples: 'restaurants near Central Park', 'IKEA stores', '52.3791,4.8994', 'coffee shops downtown'"
    ),
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
  entityTypeSet: z.string().optional().describe("Filter results by entity types"),
  ofs: z.number().optional().describe("Offset for pagination of results"),
  idxSet: z.string().optional().describe("Filter results by index set"),
  relatedPois: z.string().optional().describe("Include related points of interest"),
  ext: z.string().optional().describe("Extended parameters for the search"),
  connectors: z.boolean().optional().describe("Include connector information for EV stations"),
  categorySet: z
    .string()
    .optional()
    .describe(
      "Filter by POI category IDs. Examples: '7315' (restaurants), '7315025,7315017' (Italian or French restaurants), '9663' (EV charging). See POI Categories endpoint for full list."
    ),
};

export const tomtomPOISearchSchema = {
  query: z
    .string()
    .describe(
      "Specific POI category search. Best for finding types of businesses: 'restaurants', 'gas stations', 'hotels', 'parking', 'ATMs', 'hospitals'"
    ),
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
  lat: z
    .number()
    .optional()
    .describe("Latitude for location context. STRONGLY recommended for relevant local results."),
  lon: z
    .number()
    .optional()
    .describe("Longitude for location context. Must be used with lat parameter."),
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
  categorySet: z
    .string()
    .optional()
    .describe(
      "Filter by POI category IDs. Examples: '7315' (restaurants), '7315025,7315017' (Italian or French restaurants). See POI Categories endpoint for full list."
    ),
};

export const tomtomNearbySearchSchema = {
  lat: z
    .number()
    .describe("Center latitude for nearby search. Use precise coordinates from geocoding."),
  lon: z
    .number()
    .describe("Center longitude for nearby search. Use precise coordinates from geocoding."),
  ...baseSearchParams,
  ...poiFilterParams,
  radius: z
    .number()
    .optional()
    .describe(
      "Search radius in meters. Default: 1000. Recommended: 500 (walking), 1000 (local), 5000 (driving), 20000 (wide area)."
    ),
  categorySet: z
    .string()
    .optional()
    .describe(
      "POI category filter. Common: '7315' (restaurants), '7309' (gas), '9663' (EV charging), '7311' (hotels), '9376' (parking)."
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
  ...baseSearchParams,
  ...locationBiasParams,
  ...boundingBoxParams,
  entityTypeSet: z
    .string()
    .optional()
    .describe(
      "Filter results by geographic entity types. Valid values: PostalCodeArea, CountryTertiarySubdivision, CountrySecondarySubdivision, MunicipalitySubdivision, MunicipalitySecondarySubdivision, Country, CountrySubdivision, Neighbourhood, Municipality. Note: This parameter is for geographic entities only, not POIs. For POI filtering, use categorySet instead"
    ),
  ofs: z.number().optional().describe("Offset for pagination of results"),
};

export const tomtomReverseGeocodeSearchSchema = {
  lat: z
    .number()
    .describe("Latitude coordinate (-90 to +90). Precision to 4+ decimal places recommended."),
  lon: z
    .number()
    .describe("Longitude coordinate (-180 to +180). Precision to 4+ decimal places recommended."),
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
