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
 * Response detail level for tools without geometry (point-only results).
 *
 * - compact (default): essential fields and the point coordinates of a place,
 *   fewer tokens. The untrimmed response is still cached for the map widget,
 *   so nothing visual is lost on hosts that render MCP Apps.
 * - full: the raw API response, lossless, at many times the size.
 */
export const responseDetailSchema = z
  .enum(["compact", "full"])
  .optional()
  .default("compact")
  .describe(
    "Response detail level. 'compact' (default): essential fields and point coordinates, saves tokens. 'full': the raw API response with every field, lossless and much larger."
  );

/**
 * Response detail level for tools that return geometry: routing, waypoint
 * routing, EV routing, reachable range, traffic, area search and search along
 * route (docs/adr/0003-response-detail-geometry-value.md).
 *
 * - geometry: compact plus a `geometry` key holding a GeoJSON FeatureCollection,
 *   capped at 1,000 vertices per feature.
 */
export const geometryResponseDetailSchema = z
  .enum(["compact", "geometry", "full"])
  .optional()
  .default("compact")
  .describe(
    "Response detail level. 'compact' (default): essential fields and point coordinates, no geometry. 'geometry': compact plus a 'geometry' key holding a GeoJSON FeatureCollection ([lon, lat], at most 1,000 vertices per feature); use this to get coordinates to draw or process. 'full': the raw API response, lossless and many times larger."
  );

/**
 * Type for response detail level
 */
export type ResponseDetail = z.infer<typeof geometryResponseDetailSchema>;
