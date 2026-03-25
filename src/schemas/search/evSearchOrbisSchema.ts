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
import { responseDetailSchema } from "../shared/responseOptions";
import { uiVisibilityParam } from "./commonOrbis";

/**
 * Schema for the EV Charging Station Search tool.
 * Uses TomTom Maps SDK `search()` + `getPlacesWithEVAvailability()` for
 * finding EV charging stations with real-time availability data.
 *
 * SDK functions used:
 * - search({ poiCategories: [7309], ... }) from @tomtom-org/maps-sdk/services
 * - getPlacesWithEVAvailability(places) from @tomtom-org/maps-sdk/services
 */
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
