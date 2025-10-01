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

// Shared search parameter schemas
export const baseSearchParams = {
  limit: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum number of results to return (1-100). Default: 5"),

  language: z
    .string()
    .optional()
    .describe(
      "Preferred language for results using IETF language tags. Examples: 'en-US', 'fr-FR', 'de-DE', 'es-ES'"
    ),

  countrySet: z
    .string()
    .optional()
    .describe(
      "Limit results to specific countries using ISO codes. Examples: 'US', 'FR,GB', 'CA,US'"
    ),

  view: z
    .string()
    .optional()
    .describe(
      "Geopolitical view for disputed territories. Options: 'Unified', 'AR', 'IL', 'IN', 'MA', 'PK', 'RU', 'TR', 'CN'"
    ),

  extendedPostalCodesFor: z
    .string()
    .optional()
    .describe(
      "Include extended postal codes for specific index types. Examples: 'PAD', 'PAD,Addr', 'POI'"
    ),

  mapcodes: z
    .array(z.string())
    .optional()
    .describe(
      "Include mapcode information in the response. Mapcodes represent specific locations within a few meters and are designed to be short, easy to recognize and communicate. Options: Local, International, Alternative. Examples: 'Local' (local mapcode only), 'Local,Alternative' (multiple types). Accepts array of string(s)."
    ),

  timeZone: z
    .string()
    .optional()
    .describe(
      "Used to indicate the mode in which the timeZone object should be returned. Values: iana Mode shows the IANA ID which allows the user to determine the current time zone for the POI. Usage examples: timeZone=iana"
    ),
};

export const locationBiasParams = {
  lat: z.number().optional().describe("Center latitude for location bias"),

  lon: z.number().optional().describe("Center longitude for location bias"),

  radius: z.number().optional().describe("Search radius in meters when lat/lon provided"),
};

export const boundingBoxParams = {
  topLeft: z
    .string()
    .optional()
    .describe(
      "Top-left coordinates of bounding box (format: 'lat,lon'). Must be used with btmRight"
    ),

  btmRight: z
    .string()
    .optional()
    .describe(
      "Bottom-right coordinates of bounding box (format: 'lat,lon'). Must be used with topLeft"
    ),
};

export const poiFilterParams = {
  brandSet: z
    .string()
    .optional()
    .describe(
      "Filter by brand names. Examples: 'Starbucks,Peet\\'s', 'Marriott,Hilton'. Use quotes for brands with commas."
    ),

  connectorSet: z
    .string()
    .optional()
    .describe("EV connector types: 'IEC62196Type2CableAttached', 'Chademo', 'TeslaConnector'"),

  fuelSet: z
    .string()
    .optional()
    .describe("Fuel types: 'Petrol', 'Diesel', 'LPG', 'Hydrogen', 'E85'"),

  vehicleTypeSet: z
    .string()
    .optional()
    .describe(
      "A comma-separated list of vehicle types that could be used to restrict the result to the Points Of Interest of specific vehicles. If vehicleTypeSet is specified, the query can remain empty. Only POIs with a proper vehicle type will be returned. Value: A comma-separated list of vehicle type identifiers (in any order). When multiple vehicles types are provided, only POIs that belong to (at least) one of the vehicle types from the provided list will be returned. Available vehicle types: Car , Truck"
    ),

  minPowerKW: z.number().optional().describe("Minimum charging power in kW for EV stations"),

  maxPowerKW: z.number().optional().describe("Maximum charging power in kW for EV stations"),

  openingHours: z
    .string()
    .optional()
    .describe(
      "List of opening hours for a POI (Points of Interest).Value: `nextSevenDays` Mode shows the opening hours for next week, starting with the current day in the local time of the POI. Usage example: openingHours=nextSevenDays"
    ),
};
