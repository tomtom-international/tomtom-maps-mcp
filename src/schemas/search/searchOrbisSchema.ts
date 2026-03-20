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
      For POI filtering, use categorySet instead`),
  ofs: z.number().optional().describe("Offset for pagination of results"),
  idxSet: z.string().optional().describe("Filter results by index set"),
  relatedPois: z.string().optional().describe("Include related points of interest"),
  ext: z.string().optional().describe("Extended parameters for the search"),
  categorySet: z
    .string()
    .optional()
    .describe(
      `Filter POI per category using category IDs.
      Examples: 
      '7315' (Restaurant), '9361' (Shop), '7311' (Gas Station), '7321' (Hospital),
      '7397' (ATM), '7327' (Department Store), '7314' (Hotel/Motel), '9361009' (Convenience Store),
      '7324' (Post Office), '7383' (Airport), '7380' (Railroad Station), '9942' (Public Transportation Stop),
      '7313' (Parking Garage), '7369' (Open Parking Area), '7342' (Movie Theater),
      '9362' (Park & Recreation Area), '7310' (Repair Shop), '9376' (Café/Pub), '9379' (Nightlife),
      '7318' (Theater), '7317' (Museum), '7312' (Rent-a-Car Facility), '7372' (School),
      '7322' (Police Station), '7326' (Pharmacy), '9352' (Company), '7376' (Tourist Attraction),
      '7332005' (Supermarkets & Hypermarkets), '7315015' (Fast Food)`
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
      `Filter POI per category using category IDs.
      Examples: 
      '7315' (Restaurant), '9361' (Shop), '7311' (Gas Station), '7321' (Hospital),
      '7397' (ATM), '7327' (Department Store), '7314' (Hotel/Motel), '9361009' (Convenience Store),
      '7324' (Post Office), '7383' (Airport), '7380' (Railroad Station), '9942' (Public Transportation Stop),
      '7313' (Parking Garage), '7369' (Open Parking Area), '7342' (Movie Theater),
      '9362' (Park & Recreation Area), '7310' (Repair Shop), '9376' (Café/Pub), '9379' (Nightlife),
      '7318' (Theater), '7317' (Museum), '7312' (Rent-a-Car Facility), '7372' (School),
      '7322' (Police Station), '7326' (Pharmacy), '9352' (Company), '7376' (Tourist Attraction),
      '7332005' (Supermarkets & Hypermarkets), '7315015' (Fast Food)`
    ),
};

export const tomtomNearbySearchSchema = {
  lat: z
    .number()
    .describe("Center latitude for nearby search. Use precise coordinates from geocoding."),
  lon: z
    .number()
    .describe("Center longitude for nearby search. Use precise coordinates from geocoding."),
  ...uiVisibilityParam,
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
      `Filter POI per category using category IDs.
      Examples: 
      '7315' (Restaurant), '9361' (Shop), '7311' (Gas Station), '7321' (Hospital),
      '7397' (ATM), '7327' (Department Store), '7314' (Hotel/Motel), '9361009' (Convenience Store),
      '7324' (Post Office), '7383' (Airport), '7380' (Railroad Station), '9942' (Public Transportation Stop),
      '7313' (Parking Garage), '7369' (Open Parking Area), '7342' (Movie Theater),
      '9362' (Park & Recreation Area), '7310' (Repair Shop), '9376' (Café/Pub), '9379' (Nightlife),
      '7318' (Theater), '7317' (Museum), '7312' (Rent-a-Car Facility), '7372' (School),
      '7322' (Police Station), '7326' (Pharmacy), '9352' (Company), '7376' (Tourist Attraction),
      '7332005' (Supermarkets & Hypermarkets), '7315015' (Fast Food)`
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
