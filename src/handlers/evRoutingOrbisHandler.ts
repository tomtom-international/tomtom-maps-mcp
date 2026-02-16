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
 * Handler for Long Distance EV Routing tool.
 * Processes SDK Routes response (GeoJSON) and trims for token efficiency.
 */

import { logger } from "../utils/logger";
import { calculateEVRoute } from "../services/routing/evRoutingSDKService";
import { buildCompressedResponse } from "./shared/responseTrimmer";

/**
 * Trim SDK Routes GeoJSON for EV routing.
 * Removes heavy coordinate arrays, speedLimit data, detailed guidance,
 * and verbose charging stop metadata while keeping route summary,
 * charging stop essentials, and energy consumption data.
 */
function trimEVRoutingResponse(response: any): any {
  if (!response?.features) return response;

  const trimmed = structuredClone(response);

  trimmed.features = trimmed.features.map((feature: any) => {
    const props = feature.properties || {};

    // Remove heavy coordinate geometry (kept in full data for visualization)
    if (feature.geometry?.coordinates) {
      const coords = feature.geometry.coordinates;
      if (Array.isArray(coords) && coords.length > 2) {
        feature.geometry = {
          ...feature.geometry,
          coordinates: [coords[0], coords[coords.length - 1]],
          _trimmed: true,
          _originalPointCount: coords.length,
        };
      }
    }

    // Strip sections down to only agent-useful ones: leg (charging stops), country, toll
    if (props.sections) {
      const { leg, country, toll } = props.sections;
      props.sections = {
        ...(leg ? { leg } : {}),
        ...(country ? { country } : {}),
        ...(toll ? { toll } : {}),
      };

      // Trim charging info inside leg summaries
      if (props.sections.leg) {
        props.sections.leg = props.sections.leg.map((legItem: any) => {
          const ci = legItem.summary?.chargingInformationAtEndOfLeg;
          if (ci) {
            legItem.summary.chargingInformationAtEndOfLeg = trimChargingInfo(ci);
          }
          return legItem;
        });
      }
    }

    // Remove point-by-point progress (607+ entries)
    delete props.progress;

    return feature;
  });

  return trimmed;
}

/**
 * Trim verbose charging stop GeoJSON Feature.
 * Keeps: name, address, position, power, charge time/target.
 * Removes: UUIDs, opening hours, nearby services, operator details.
 */
function trimChargingInfo(info: any): any {
  if (!info) return info;

  // Charging info is a GeoJSON Feature with point geometry
  const p = info.properties || {};
  return {
    type: "Feature",
    geometry: info.geometry,
    properties: {
      chargingParkName: p.chargingParkName,
      chargingParkPowerInkW: p.chargingParkPowerInkW,
      chargingTimeInSeconds: p.chargingTimeInSeconds,
      targetChargeInkWh: p.targetChargeInkWh,
      ...(p.address?.freeformAddress ? { address: p.address.freeformAddress } : {}),
    },
  };
}

/**
 * Create handler for Long Distance EV Routing tool.
 */
export function createEVRoutingHandler() {
  return async (params: any) => {
    logger.info("EV route calculation");
    try {
      const { show_ui = true, response_detail = "compact", ...routeParams } = params;

      const result = await calculateEVRoute(routeParams);

      logger.info({ routeCount: result?.features?.length || 0 }, "EV route calculation completed");

      // If full response requested, return without trimming
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
        };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimEVRoutingResponse(result);
      return await buildCompressedResponse(trimmed, result, show_ui);
    } catch (error: any) {
      logger.error({ error: error.message }, "EV route calculation failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  };
}
