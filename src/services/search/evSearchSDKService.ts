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
import { getEffectiveApiKey } from "../base/tomtomClient";
import { logger } from "../../utils/logger";

export interface EVSearchParams {
  query?: string;
  lat: number;
  lon: number;
  radius?: number;
  connectorTypes?: string[];
  minPowerKW?: number;
  limit?: number;
  includeAvailability?: boolean;
  language?: string;
  countrySet?: string;
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
export async function searchEVStations(params: EVSearchParams): Promise<any> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error("API key not available");

  logger.debug(
    { lat: params.lat, lon: params.lon, radius: params.radius },
    "Searching EV charging stations via SDK"
  );

  // Build SDK FuzzySearchParams
  const searchParams: any = {
    apiKey,
    query: params.query || "EV charging station",
    poiCategories: [7309], // 7309 = Electric Vehicle Station category
    position: [params.lon, params.lat],
    limit: params.limit || 10,
  };

  if (params.radius) searchParams.radiusMeters = params.radius;
  if (params.connectorTypes) searchParams.connectors = params.connectorTypes;
  if (params.language) searchParams.language = params.language;
  if (params.countrySet) {
    searchParams.countries = params.countrySet.split(",").map((c: string) => c.trim());
  }

  // Call SDK search
  const searchResult = await search(searchParams);

  // Post-filter by minimum power if requested (SDK doesn't support this natively)
  let filteredResult = searchResult;
  if (params.minPowerKW && searchResult.features?.length) {
    filteredResult = {
      ...searchResult,
      features: searchResult.features.filter((feature: any) => {
        const chargingPark = feature.properties?.chargingPark;
        if (!chargingPark?.connectors) return true; // Keep if no connector data
        return chargingPark.connectors.some((c: any) => c.ratedPowerKW >= (params.minPowerKW || 0));
      }),
    };
  }

  // Enrich with real-time availability if requested
  if (params.includeAvailability !== false && filteredResult.features?.length > 0) {
    try {
      const enriched = await getPlacesWithEVAvailability(filteredResult as any);
      logger.debug(
        { stationCount: enriched.features?.length },
        "EV availability enrichment successful"
      );
      return enriched;
    } catch (e: any) {
      logger.warn(
        { error: e.message },
        "EV availability enrichment failed, returning basic search results"
      );
      return filteredResult;
    }
  }

  return filteredResult;
}
