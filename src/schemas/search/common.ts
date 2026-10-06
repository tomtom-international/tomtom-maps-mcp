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

import { geographyTypes, geopoliticalViews, type Fuel } from "@tomtom-org/maps-sdk/core";
import { z } from "zod";
import { responseDetailSchema } from "../shared/responseOptions";

/** The SDK types Fuel but exports no list: keyed, so a fuel it adds or drops fails to compile. */
export const FUEL_TYPES: Record<Fuel, true> = {
  Petrol: true,
  LPG: true,
  Diesel: true,
  Biodiesel: true,
  DieselForCommercialVehicles: true,
  E85: true,
  LNG: true,
  CNG: true,
  Hydrogen: true,
  AdBlue: true,
};

/** For the geography filters, which take a comma-separated string. */
export const GEOGRAPHY_TYPES_HINT = `comma-separated: ${geographyTypes.join(", ")}`;

// Shared search parameter schemas
export const baseSearchParams = {
  response_detail: responseDetailSchema,

  limit: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum number of results to return (1-100). Default: 10."),

  language: z
    .string()
    .optional()
    .describe(
      "Preferred language for results using IETF language tags. Examples: 'en-US', 'fr-FR', 'de-DE', 'es-ES'"
    ),

  countries: z
    .array(z.string())
    .optional()
    .describe(
      "Limit results to specific countries using ISO alpha-2 codes. Example: ['US'], ['FR', 'GB'], ['NL', 'DE']"
    ),

  view: z
    .enum(geopoliticalViews)
    .optional()
    .describe("Geopolitical view for disputed territories."),

  cursor: z
    .string()
    .optional()
    .describe(
      "The next page of results: the nextCursor of the previous response, with the same other parameters."
    ),

  extendedPostalCodesFor: z
    .string()
    .optional()
    .describe(
      "Comma-separated index types whose results carry extended postal codes: Geo, PAD, Addr, Str, XStr, and POI for POI results. Default: every type except Geo, so listing types removes the codes from the others. Examples: 'PAD,Addr', 'Geo'."
    ),

  mapcodes: z
    .array(z.string())
    .optional()
    .describe(
      "Include mapcode information in the response. Mapcodes represent specific locations within a few meters and are designed to be short, easy to recognize and communicate. Options: Local, International, Alternative. Examples: ['Local'] (local mapcode only), ['Local', 'Alternative'] (multiple types)."
    ),
};

/** POI search only: geocoding results carry no time zone. */
export const timeZoneParams = {
  timeZone: z
    .string()
    .optional()
    .describe(
      "Used to indicate the mode in which the timeZone object should be returned. Values: iana Mode shows the IANA ID which allows the user to determine the current time zone for the POI. Usage examples: timeZone=iana"
    ),
};

export const locationBiasParams = {
  position: z
    .array(z.number())
    .length(2)
    .optional()
    .describe(
      "Center position as [longitude, latitude] for location bias (GeoJSON convention). " +
        "Example: [4.89707, 52.377956] for Amsterdam. Not with boundingBox."
    ),

  radius: z
    .number()
    .optional()
    .describe("Search radius in meters around position; needs position."),
};

export const boundingBoxParams = {
  boundingBox: z
    .array(z.number())
    .length(4)
    .optional()
    .describe(
      "Bounding box as [minLon, minLat, maxLon, maxLat] (GeoJSON convention). " +
        "Example: [4.8, 52.3, 4.95, 52.45] for Amsterdam area. Not with position."
    ),
};

export const poiFilterParams = {
  brandSet: z
    .string()
    .optional()
    .describe("Filter by brand names, comma-separated. Examples: 'Starbucks', 'Marriott,Hilton'."),

  connectorSet: z
    .string()
    .optional()
    .describe(
      "EV connector types, comma-separated. Examples: 'IEC62196Type2CCS', 'IEC62196Type2CableAttached,Chademo', 'Tesla'."
    ),

  fuelSet: z
    .string()
    .optional()
    .describe(`Fuel types, comma-separated: ${Object.keys(FUEL_TYPES).join(", ")}.`),

  minPowerKW: z.number().optional().describe("Minimum charging power in kW for EV stations"),

  maxPowerKW: z.number().optional().describe("Maximum charging power in kW for EV stations"),

  openingHours: z
    .string()
    .optional()
    .describe(
      "List of opening hours for a POI (Points of Interest).Value: `nextSevenDays` Mode shows the opening hours for next week, starting with the current day in the local time of the POI. Usage example: openingHours=nextSevenDays"
    ),
};
