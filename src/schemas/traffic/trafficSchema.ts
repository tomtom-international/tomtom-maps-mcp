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

export const tomtomTrafficSchema = {
  bbox: z
    .string()
    .optional()
    .describe(
      "Bounding box for traffic area: 'minLon,minLat,maxLon,maxLat'. Example: '-74.02,40.70,-73.96,40.80' for lower Manhattan. Use smaller areas for better results."
    ),

  language: z
    .string()
    .optional()
    .describe(
      "Language for incident descriptions: 'en-US', 'de-DE', 'fr-FR', 'es-ES'. Default: 'en-US'."
    ),

  maxResults: z
    .number()
    .min(1)
    .max(1000)
    .optional()
    .describe(
      "Maximum incidents to return (1-1000). Use 10-20 for readability in high-traffic areas."
    ),

  categoryFilter: z
    .string()
    .optional()
    .describe(
      "Filter by incident categories (comma-separated): '0' (Accident), '1' (Fog), '2' (Dangerous Conditions), '3' (Rain), '4' (Ice), '5' (Lane Restrictions), '6' (Lane Closure), '7' (Road Closure), '8' (Road Works), '9' (Wind), '10' (Flooding), '11' (Detour), '14' (Cluster)."
    ),

  incidentTypes: z
    .string()
    .optional()
    .describe(
      "Filter by incident types (comma-separated): '0' (Accident), '1' (Fog), '4' (Ice), '5' (Lane Restrictions), '7' (Closure), '8' (Roadworks)."
    ),

  timeFilter: z
    .enum(["present", "future"])
    .optional()
    .describe(
      "Time validity filter: 'present' (current), 'future' (upcoming). Default: 'present'."
    ),

  t: z
    .number()
    .optional()
    .describe("Unix Timestamp in seconds for traffic model. Use current time if not provided."),
};
