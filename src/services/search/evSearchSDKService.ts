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
 *
 * EV Charging Station Search SDK Service
 * Uses TomTom Maps SDK search() + getPlacesWithEVAvailability() directly
 * instead of raw REST API calls.
 */

import { search, getPlacesWithEVAvailability } from "@tomtom-org/maps-sdk/services";
import type { Places, POICategory } from "@tomtom-org/maps-sdk/core";
import { getEffectiveApiKey } from "../base/tomtomClient";
import { logger } from "../../utils/logger";
import type { Position } from "geojson";

export interface EVSearchParams {
  query?: string;
  /** Center position as [longitude, latitude] (GeoJSON convention) */
  position: Position;
  radius?: number;
  connectorTypes?: string[];
  minPowerKW?: number;
  limit?: number;
  includeAvailability?: boolean;
  language?: string;
  countries?: string[];
}

/**
 * Search for EV charging stations using TomTom Maps SDK.
 *
 * Uses SDK's search() with poiCategories filter for EV stations,
 * then enriches results with real-time availability via getPlacesWithEVAvailability().
 *
 * @param params Search parameters
 * @returns SDK SearchResponse (GeoJSON FeatureCollection) - already in SDK format,
 *          no additional parsing needed on the app side
 */
export async function searchEVStations(params: EVSearchParams): Promise<Places> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error("API key not available");

  logger.debug(
    { lng: params.position[0], lat: params.position[1], radius: params.radius },
    "Searching EV charging stations via SDK"
  );

  // Build SDK search params
  const searchParams: Record<string, unknown> = {
    apiKey,
    query: params.query || "EV charging station",
    poiCategories: ["ELECTRIC_VEHICLE_STATION"] as POICategory[],
    position: params.position,
    limit: params.limit || 10,
  };

  if (params.radius) searchParams.radiusMeters = params.radius;
  if (params.connectorTypes) searchParams.connectors = params.connectorTypes;
  if (params.language) searchParams.language = params.language;
  if (params.countries && params.countries.length > 0) {
    searchParams.countries = params.countries;
  }

  // Call SDK search
  const searchResult = await search(searchParams as Parameters<typeof search>[0]);

  // Post-filter by minimum power if requested (SDK doesn't support this natively)
  let filteredResult = searchResult;
  if (params.minPowerKW && searchResult.features?.length) {
    const minPower = params.minPowerKW;
    filteredResult = {
      ...searchResult,
      features: searchResult.features.filter((feature) => {
        const chargingPark = (feature.properties as Record<string, unknown> | null)
          ?.chargingPark as { connectors?: Array<{ ratedPowerKW?: number }> } | undefined;
        if (!chargingPark?.connectors) return true;
        return chargingPark.connectors.some((c) => (c.ratedPowerKW ?? 0) >= minPower);
      }),
    };
  }

  // Enrich with real-time availability if requested
  if (params.includeAvailability !== false && filteredResult.features?.length > 0) {
    try {
      const enriched = await getPlacesWithEVAvailability(filteredResult);
      logger.debug(
        { stationCount: enriched.features?.length },
        "EV availability enrichment successful"
      );
      return enriched;
    } catch (e: unknown) {
      logger.warn(
        { error: e instanceof Error ? e.message : String(e) },
        "EV availability enrichment failed, returning basic search results"
      );
      return filteredResult;
    }
  }

  return filteredResult;
}
