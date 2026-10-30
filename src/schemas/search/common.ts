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
import { responseDetailSchema } from "../shared/responseOptions";

/** For the geography filters, which take a comma-separated string. */
export const GEOGRAPHY_TYPES_HINT = `comma-separated: ${geographyTypes.join(", ")}`;

/** The reverse geocode tool's result shape, language and geopolitical view. */
export const baseSearchParams = {
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
};
