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

import { tomtomClient, getEffectiveApiKey, ORBIS_API_VERSION } from "../base/tomtomClient";
import { handleApiError } from "../../utils/apiErrorHandler";
import { logger } from "../../utils/logger";
import { TrafficIncidentsOptions, TrafficIncidentsResult, DEFAULT_OPTIONS } from "./types";
import type { BBox } from "@tomtom-org/maps-sdk/core";

/**
 * Get traffic incidents in a specified bounding box area.
 *
 * @param bbox Bounding box as [minLon, minLat, maxLon, maxLat] (GeoJSON convention)
 * @param options Additional options for filtering incidents
 * @returns List of traffic incidents with details
 */
export async function getTrafficIncidents(
  bbox: BBox,
  options: TrafficIncidentsOptions = {}
): Promise<TrafficIncidentsResult> {
  try {
    const apiKey = getEffectiveApiKey();
    if (!apiKey) throw new Error("API key not available");

    const [minLon, minLat, maxLon, maxLat] = bbox;
    const bboxStr = `${minLon},${minLat},${maxLon},${maxLat}`;

    logger.debug(
      {
        bbox: bboxStr,
        language: options.language || DEFAULT_OPTIONS.language,
        timeValidityFilter: options.timeValidityFilter || DEFAULT_OPTIONS.timeValidityFilter,
      },
      "Getting traffic incidents"
    );

    const params: Record<string, string | number> = {
      key: apiKey,
      bbox: bboxStr,
      apiVersion: ORBIS_API_VERSION.TRAFFIC,
      fields: options.fields || DEFAULT_OPTIONS.fields,
      language: options.language || DEFAULT_OPTIONS.language,
      timeValidityFilter: options.timeValidityFilter || DEFAULT_OPTIONS.timeValidityFilter,
    };

    if (options.maxResults !== undefined) params.maxResults = options.maxResults;

    if (options.categoryFilter) {
      params.categoryFilter = Array.isArray(options.categoryFilter)
        ? options.categoryFilter.join(",")
        : options.categoryFilter;
    }

    const response = await tomtomClient.get(`/maps/orbis/traffic/incidentDetails`, { params });
    return response.data;
  } catch (error) {
    throw handleApiError(error);
  }
}
