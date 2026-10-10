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
  type TrafficIncidentDetailsByBBoxParams,
  trafficIncidentDetails,
} from "@tomtom-org/maps-sdk/services";
import { logger } from "../../utils/logger";
import { requireApiKey } from "../api-key";
import { toLanguage } from "../shared/sdkInputs";
import type { TrafficIncidentsOptions } from "./types";

/**
 * Get traffic incidents in a bounding box.
 *
 * @param bbox Bounding box as [minLon, minLat, maxLon, maxLat] (GeoJSON convention)
 * @param options Language and category and time filters
 */
export async function getTrafficIncidents(
  bbox: BBox,
  options: TrafficIncidentsOptions = {}
): Promise<TrafficIncidentDetails> {
  const params: TrafficIncidentDetailsByBBoxParams = {
    apiKey: requireApiKey(),
    bbox,
    language: toLanguage(options.language ?? "en-GB"),
  };
  if (options.categoryFilter?.length) params.categoryFilter = options.categoryFilter;
  if (options.timeValidityFilter?.length) params.timeValidityFilter = options.timeValidityFilter;

  logger.debug({ bbox, ...options }, "Getting traffic incidents");
  return trafficIncidentDetails(params);
}
