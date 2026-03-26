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
import { responseDetailSchema } from "../shared/responseOptions";

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
    .array(z.number())
    .length(2)
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
    .array(z.number())
    .length(2)
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

// ---------------------------------------------------------------------------
// Area / Geometry Search
// ---------------------------------------------------------------------------

export const tomtomAreaSearchSchema = {
  query: z
    .string()
    .describe(
      "What to search for in the area. Examples: 'restaurant', 'hotel', 'parking', 'pharmacy', 'ATM'."
    ),

  // Circle geometry (most common)
  center: z
    .array(z.number())
    .length(2)
    .optional()
    .describe(
      "Center position as [longitude, latitude] for circular area search (GeoJSON convention). Use with radius. " +
        "Example: [4.89707, 52.377956] for Amsterdam."
    ),

  radius: z
    .number()
    .optional()
    .describe(
      "Radius in meters for circular area search. Required with center. Examples: 500, 1000, 5000."
    ),

  // Polygon geometry (advanced)
  polygon: z
    .array(z.array(z.number()).length(2))
    .optional()
    .describe(
      "Polygon vertices as [[longitude, latitude], ...] (GeoJSON convention). Minimum 3 points, automatically closed. " +
        "Use instead of center/radius for irregular areas."
    ),

  // Bounding box (simple rectangle)
  boundingBox: z
    .array(z.array(z.number()).length(2)).length(2)
    .optional()
    .describe(
      "Rectangular bounding box as [[topLeftLon, topLeftLat], [bottomRightLon, bottomRightLat]] (GeoJSON convention). " +
        "Use instead of center/radius or polygon. Example: [[4.8, 52.45], [4.95, 52.3]] for Amsterdam area."
    ),

  limit: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum number of results (1-100). Default: 10."),

  poiCategories: z
    .array(z.string())
    .optional()
    .describe(
      "Filter POI results by UPPER_SNAKE_CASE text category codes (e.g. 'RESTAURANT', 'PARKING_GARAGE'), NOT numeric IDs. IMPORTANT: Never guess codes — always call tomtom-poi-categories first with the user's intent as keywords to discover valid codes."
    ),

  language: z
    .string()
    .optional()
    .describe("Language for results (IETF tag). Examples: 'en-US', 'de-DE'."),

  countries: z
    .array(z.string())
    .optional()
    .describe("Limit results to countries (ISO alpha-2 codes). Example: ['US'], ['DE', 'FR']."),

  ...uiVisibilityParam,
  response_detail: responseDetailSchema,
};

// ---------------------------------------------------------------------------
// EV Charging Station Search
// ---------------------------------------------------------------------------

export const tomtomEvSearchSchema = {
  query: z
    .string()
    .optional()
    .default("")
    .describe(
      "Search query for EV charging stations. Can be a station name or brand (e.g., 'Tesla Supercharger', 'ChargePoint'). Leave empty to find all nearby stations."
    ),

  position: z
    .array(z.number())
    .length(2)
    .describe(
      "Center position as [longitude, latitude] for EV station search (GeoJSON convention). " +
        "Required for location-based results. Example: [4.89707, 52.377956] for Amsterdam."
    ),

  radius: z
    .number()
    .min(1)
    .optional()
    .describe(
      "Search radius in meters. Default: 5000 (5km). Examples: 1000 (walking), 5000 (local), 20000 (wide area)."
    ),

  connectorTypes: z
    .array(z.string())
    .optional()
    .describe(
      "Filter by EV connector types. Options: 'IEC62196Type2CableAttached' (Type 2/Mennekes), 'IEC62196Type2CCS' (CCS2), 'IEC62196Type1CCS' (CCS1), 'Chademo' (CHAdeMO), 'Tesla', 'IEC62196Type1' (Type 1/J1772), 'StandardHouseholdCountrySpecific' (domestic plug). Accepts array of string(s)."
    ),

  minPowerKW: z
    .number()
    .optional()
    .describe(
      "Minimum charging power in kW. Examples: 7 (slow AC), 22 (fast AC), 50 (DC fast), 150 (ultra-fast DC)."
    ),

  limit: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum number of results (1-100). Default: 10."),

  includeAvailability: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "Include real-time charger availability data (available/occupied/out-of-service counts per connector). Default: true."
    ),

  language: z
    .string()
    .optional()
    .describe("Language for results (IETF tag). Examples: 'en-US', 'de-DE', 'fr-FR'."),

  countries: z
    .array(z.string())
    .optional()
    .describe("Limit results to countries (ISO alpha-2 codes). Example: ['US'], ['DE', 'FR']."),

  ...uiVisibilityParam,
  response_detail: responseDetailSchema,
};

// ---------------------------------------------------------------------------
// Search Along Route
// ---------------------------------------------------------------------------

export const tomtomSearchAlongRouteSchema = {
  origin: z
    .array(z.number())
    .length(2)
    .describe(
      "Route starting point as [longitude, latitude] (GeoJSON convention). " +
        "Use precise coordinates from geocoding. Example: [4.89707, 52.377956]."
    ),

  destination: z
    .array(z.number())
    .length(2)
    .describe(
      "Route ending point as [longitude, latitude] (GeoJSON convention). " +
        "Use precise coordinates from geocoding. Example: [13.404954, 52.520008]."
    ),

  query: z
    .string()
    .describe(
      "What to search for along the route. Examples: 'gas station', 'restaurant', 'coffee', 'hotel', 'EV charging'."
    ),

  corridorWidth: z
    .number()
    .optional()
    .describe(
      "Search corridor width in meters from the route centerline. Default: 5000 (5km). Smaller values = closer to route."
    ),

  limit: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum number of POI results (1-100). Default: 10."),

  poiCategories: z
    .array(z.string())
    .optional()
    .describe(
      "Filter POI results by UPPER_SNAKE_CASE text category codes (e.g. 'RESTAURANT', 'PARKING_GARAGE'), NOT numeric IDs. IMPORTANT: Never guess codes — always call tomtom-poi-categories first with the user's intent as keywords to discover valid codes."
    ),

  language: z
    .string()
    .optional()
    .describe("Language for results (IETF tag). Examples: 'en-US', 'de-DE'."),

  routeType: z
    .enum(["fast", "short", "efficient"])
    .optional()
    .describe("Route optimization for the base route. Default: 'fast'."),

  ...uiVisibilityParam,
  response_detail: responseDetailSchema,
};
