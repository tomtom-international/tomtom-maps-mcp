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
import { routeTypes } from "@tomtom-org/maps-sdk/services";
import { z } from "zod";
import {
  geometryResponseDetailSchema,
  responseDetailSchema,
  uiVisibilityParam,
} from "../shared/responseOptions";
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
  maxFuzzyLevel: z.number().optional().describe("Maximum fuzzy matching level (1-4)"),
  minFuzzyLevel: z.number().optional().describe("Minimum fuzzy matching level (1-4)"),
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
  limit: baseSearchParams.limit.describe(
    "Maximum number of results to return (1-100). Default: 20."
  ),
  ...timeZoneParams,
  ...poiFilterParams,
  radius: z
    .number()
    .optional()
    .describe(
      "Search radius in meters. Default: 1000. Recommended: 500 (walking), 1000 (local), 5000 (driving), 20000 (wide area)."
    ),
  poiCategories: z
    .array(z.string())
    .max(10)
    .optional()
    .describe(
      "POI categories to find, as UPPER_SNAKE_CASE codes (e.g. 'RESTAURANT', 'PARKING_GARAGE'), NOT numeric IDs. Required unless brandSet, connectorSet, fuelSet, minPowerKW or maxPowerKW is given. IMPORTANT: Never guess codes — always call tomtom-poi-categories first with the user's intent as keywords to discover valid codes."
    ),
  relatedPois: z
    .string()
    .optional()
    .describe(
      "Include related points of interest: 'off', 'child', 'parent' or 'all'. Default: 'off'."
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
    .positive()
    .optional()
    .describe(
      "Radius in meters for circular area search. Required with center. Examples: 500, 1000, 5000."
    ),

  // Polygon geometry (advanced)
  polygon: z
    .array(z.array(z.number()).length(2))
    .min(3)
    .optional()
    .describe(
      "Polygon vertices as [[longitude, latitude], ...] (GeoJSON convention). Minimum 3 points, automatically closed. " +
        "Use instead of center/radius for irregular areas."
    ),

  // Bounding box (simple rectangle)
  boundingBox: z
    .array(z.array(z.number()).length(2))
    .length(2)
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
    .max(10)
    .optional()
    .describe(
      "Filter POI results by UPPER_SNAKE_CASE text category codes (e.g. 'RESTAURANT', 'PARKING_GARAGE'), NOT numeric IDs. IMPORTANT: Never guess codes — always call tomtom-poi-categories first with the user's intent as keywords to discover valid codes."
    ),

  language: z
    .string()
    .optional()
    .describe("Language for results (IETF tag). Examples: 'en-US', 'de-DE'."),

  ...uiVisibilityParam,
  response_detail: geometryResponseDetailSchema,
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
      "Search radius in meters. Without it, results are biased toward position with no distance limit. Examples: 1000 (walking), 5000 (local), 20000 (wide area)."
    ),

  connectorTypes: z
    .array(z.enum(connectorTypes))
    .max(10)
    .optional()
    .describe(
      "Filter by EV connector types: 'IEC62196Type2CableAttached' is Type 2/Mennekes, 'IEC62196Type2CCS' CCS2, 'IEC62196Type1CCS' CCS1, 'IEC62196Type1' Type 1/J1772, 'StandardHouseholdCountrySpecific' a domestic plug."
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

  language: z
    .string()
    .optional()
    .describe("Language for results (IETF tag). Examples: 'en-US', 'de-DE', 'fr-FR'."),

  countries: z
    .array(z.string())
    .optional()
    .describe("Limit results to countries (ISO alpha-2 codes). Example: ['US'], ['DE', 'FR']."),

  cursor: baseSearchParams.cursor,

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
    .max(10)
    .optional()
    .describe(
      "Filter POI results by UPPER_SNAKE_CASE text category codes (e.g. 'RESTAURANT', 'PARKING_GARAGE'), NOT numeric IDs. IMPORTANT: Never guess codes — always call tomtom-poi-categories first with the user's intent as keywords to discover valid codes."
    ),

  language: z
    .string()
    .optional()
    .describe("Language for results (IETF tag). Examples: 'en-US', 'de-DE'."),

  routeType: z
    .enum(routeTypes)
    .optional()
    .describe(
      "Route optimization for the base route: 'fast', 'short', 'efficient' or 'thrilling'. Default: 'fast'."
    ),

  ...uiVisibilityParam,
  response_detail: geometryResponseDetailSchema,
};

export type FuzzySearchParams = z.input<z.ZodObject<typeof tomtomFuzzySearchSchema>>;
export type PoiSearchParams = z.input<z.ZodObject<typeof tomtomPOISearchSchema>>;
export type NearbySearchParams = z.input<z.ZodObject<typeof tomtomNearbySearchSchema>>;
export type GeocodeSearchParams = z.input<z.ZodObject<typeof tomtomGeocodeSearchSchema>>;
export type ReverseGeocodeSearchParams = z.infer<
  z.ZodObject<typeof tomtomReverseGeocodeSearchSchema>
>;
export type PoiCategoriesParams = z.input<z.ZodObject<typeof tomtomPOICategoriesSchema>>;
export type AreaSearchParams = z.input<z.ZodObject<typeof tomtomAreaSearchSchema>>;
export type EvSearchParams = z.input<z.ZodObject<typeof tomtomEvSearchSchema>>;
export type SearchAlongRouteParams = z.infer<z.ZodObject<typeof tomtomSearchAlongRouteSchema>>;
