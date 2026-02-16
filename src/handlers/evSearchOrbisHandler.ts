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
 * Handler for EV Charging Station Search tool.
 * Processes SDK response (GeoJSON FeatureCollection) and trims for token efficiency.
 */

import { logger } from "../utils/logger";
import { searchEVStations } from "../services/search/evSearchSDKService";
import { buildCompressedResponse } from "./shared/responseTrimmer";

/**
 * Trim SDK GeoJSON search response for EV stations.
 * Removes verbose properties while keeping essential EV-specific data
 * (station name, address, connector types, power, availability).
 */
function trimEVSearchResponse(response: any): any {
  if (!response?.features) return response;

  const trimmed = structuredClone(response);

  trimmed.features = trimmed.features.map((feature: any) => {
    const props = feature.properties || {};

    // Trim POI details — keep name, phone, url
    if (props.poi) {
      delete props.poi.classifications;
      delete props.poi.categorySet;
      delete props.poi.timeZone;
      delete props.poi.features;
      delete props.poi.brands;
      delete props.poi.openingHours;
    }

    // Remove verbose metadata
    delete props.dataSources;
    delete props.matchConfidence;
    delete props.info;
    delete props.score;
    delete props.viewport;
    delete props.boundingBox;
    delete props.entryPoints;

    // Trim address — keep freeformAddress, streetName, municipality, countryCode
    if (props.address) {
      delete props.address.countryCodeISO3;
      delete props.address.countrySubdivisionCode;
      delete props.address.countrySubdivisionName;
      delete props.address.localName;
      delete props.address.extendedPostalCode;
    }

    // Simplify chargingPark connectors — keep type, power, speed, count
    if (props.chargingPark?.connectors) {
      props.chargingPark.connectors = props.chargingPark.connectors.map((c: any) => ({
        type: c.connector?.type,
        ratedPowerKW: c.connector?.ratedPowerKW,
        currentType: c.connector?.currentType,
        chargingSpeed: c.connector?.chargingSpeed,
        count: c.count,
      }));
    }

    // Remove internal IDs from POI
    if (props.poi) {
      delete props.poi.categoryIds;
    }

    return feature;
  });

  return trimmed;
}

/**
 * Create handler for EV Charging Station Search tool.
 */
export function createEVSearchHandler() {
  return async (params: any) => {
    logger.info("EV charging station search");
    try {
      const { show_ui = true, response_detail = "compact", ...searchParams } = params;

      const result = await searchEVStations(searchParams);

      logger.info(
        { stationCount: result?.features?.length || 0 },
        "EV charging station search completed"
      );

      // If full response requested, return without trimming
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
        };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimEVSearchResponse(result);
      return await buildCompressedResponse(trimmed, result, show_ui);
    } catch (error: any) {
      logger.error({ error: error.message }, "EV charging station search failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}
