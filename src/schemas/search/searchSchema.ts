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

import { geographyTypes, geopoliticalViews } from "@tomtom-org/maps-sdk/core";
import { z } from "zod";
import { coordinateSchema } from "../routing/common";
import { responseDetailSchema, uiVisibilityParam } from "../shared/responseOptions";

export const tomtomReverseGeocodeSearchSchema = {
  position: coordinateSchema.describe(
    "Position as [longitude, latitude] to reverse geocode (GeoJSON convention). " +
      "Precision to 4+ decimal places recommended. Example: [4.89707, 52.377956]."
  ),
  ...uiVisibilityParam,
  response_detail: responseDetailSchema,
  language: z
    .string()
    .optional()
    .describe(
      "Preferred language for results using IETF language tags. Examples: 'en-US', 'fr-FR', 'de-DE', 'es-ES'"
    ),
  view: z
    .enum(geopoliticalViews)
    .optional()
    .describe("Geopolitical view for disputed territories."),
  radius: z.number().optional().describe("Search radius in meters. Default: 100"),
  heading: z
    .number()
    .optional()
    .describe("Heading direction in degrees (0-360) for improved accuracy on roads"),
  entityType: z
    .string()
    .optional()
    .describe(
      `Filter by geography entity types, comma-separated: ${geographyTypes.join(", ")}. ` +
        "Not with heading, which the API then ignores."
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

export type ReverseGeocodeSearchParams = z.input<
  z.ZodObject<typeof tomtomReverseGeocodeSearchSchema>
>;
export type PoiCategoriesParams = z.input<z.ZodObject<typeof tomtomPOICategoriesSchema>>;
