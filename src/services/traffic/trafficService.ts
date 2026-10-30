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

import type { BBox, TrafficIncidentDetails } from "@tomtom-org/maps-sdk/core";
import {
  type TrafficIncidentDetailsParams,
  trafficIncidentDetails,
} from "@tomtom-org/maps-sdk/services";
import type { MultiPolygon, Polygon } from "geojson";
import { logger } from "../../utils/logger";
import { requireApiKey } from "../api-key";
import { toLanguage } from "../shared/sdkInputs";
import type { TrafficIncidentsOptions } from "./types";

/**
 * Get traffic incidents in an area: a [minLon, minLat, maxLon, maxLat] box, or a
 * polygon, whose incidents outside it are dropped. Either way the area's bounds
 * must cover at most 10,000 km².
 *
 * @param options Language and category and time filters
 */
export async function getTrafficIncidents(
  area: BBox | Polygon | MultiPolygon,
  options: TrafficIncidentsOptions = {}
): Promise<TrafficIncidentDetails> {
  const base = {
    apiKey: requireApiKey(),
    language: toLanguage(options.language ?? "en-GB"),
    ...(options.categoryFilter?.length && { categoryFilter: options.categoryFilter }),
    ...(options.timeValidityFilter?.length && { timeValidityFilter: options.timeValidityFilter }),
  };
  const params: TrafficIncidentDetailsParams = Array.isArray(area)
    ? { ...base, bbox: area }
    : { ...base, polygon: area };

  logger.debug(
    { area: Array.isArray(area) ? area : area.type, ...options },
    "Getting traffic incidents"
  );
  return trafficIncidentDetails(params);
}
