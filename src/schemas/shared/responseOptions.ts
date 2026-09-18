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

/**
 * Response detail level schema.
 * Allows agents to choose between compact (trimmed) and full responses.
 *
 * - compact: Returns trimmed response with essential fields only (default)
 *   - Significantly reduces token usage
 *   - Keeps the point coordinates of a place, but drops large geometry:
 *     route polylines, isoline boundary polygons, traffic incident shapes
 *   - The untrimmed response is still cached for the map widget, so nothing
 *     visual is lost on hosts that render MCP Apps
 *
 * - full: Returns complete API response with all fields, geometry included
 *   - The only way for the caller itself to obtain that geometry, e.g. to
 *     export GeoJSON, run its own analysis, or draw it on a non-TomTom map
 *   - Substantially larger: a long route can exceed 500KB
 */
export const responseDetailSchema = z
  .enum(["compact", "full"])
  .optional()
  .default("compact")
  .describe(
    "Response detail level. 'compact' (default): essential fields and point coordinates, with large geometry (route lines, isoline polygons, incident shapes) omitted. 'full': everything including that geometry — use when you need it to export or draw the result elsewhere; much larger, a long route exceeds 500KB."
  );

/**
 * Type for response detail level
 */
export type ResponseDetail = z.infer<typeof responseDetailSchema>;
