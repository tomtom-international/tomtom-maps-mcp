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
  trafficIncidentRequestCategories,
  type TrafficIncidentTimeValidity,
} from "@tomtom-org/maps-sdk/core";
import { geometryResponseDetailSchema, uiVisibilityParam } from "../shared/responseOptions";

export const tomtomTrafficSchema = {
  ...uiVisibilityParam,
  response_detail: geometryResponseDetailSchema,

  bbox: z
    .array(z.number())
    .length(4)
    .describe(
      "Bounding box as [minLon, minLat, maxLon, maxLat] (GeoJSON convention). " +
        "Example: [-74.02, 40.70, -73.96, 40.80] for lower Manhattan. Use smaller areas for better results."
    ),

  language: z
    .string()
    .optional()
    .describe(
      "Language for incident descriptions: 'en-GB', 'de-DE', 'fr-FR', 'es-ES'. Default: 'en-GB'."
    ),

  categoryFilter: z
    .array(z.enum(trafficIncidentRequestCategories))
    .optional()
    .describe("Incident categories to return. Default: all categories."),

  timeValidityFilter: z
    .array(z.enum(["present", "future"] satisfies TrafficIncidentTimeValidity[]))
    .optional()
    .describe(
      "Which incidents to return by time: 'present' (happening now), 'future' (planned, e.g. road works). Default: ['present']."
    ),

  maxResults: z
    .number()
    .min(1)
    .max(1000)
    .optional()
    .describe(
      "Maximum number of incidents to return (1-1000). Default: 100. " +
        "When more incidents match, the most severe are returned and the response includes an incidentSummary with full totals."
    ),
};

export type TrafficParams = z.input<z.ZodObject<typeof tomtomTrafficSchema>>;
