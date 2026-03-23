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
import type { Routes } from "@tomtom-org/maps-sdk/core";

interface ChargingInfoProperties {
  chargingParkName?: string;
  chargingParkPowerInkW?: number;
  chargingTimeInSeconds?: number;
  targetChargeInkWh?: number;
  address?: { freeformAddress?: string; [key: string]: unknown };
  [key: string]: unknown;
}

interface ChargingInfo {
  geometry?: unknown;
  properties?: ChargingInfoProperties;
  [key: string]: unknown;
}

interface LegItem {
  summary?: {
    chargingInformationAtEndOfLeg?: ChargingInfo;
    [key: string]: unknown;
  };
  endPointIndex?: number;
  [key: string]: unknown;
}

/**
 * Trim SDK Routes GeoJSON for EV routing.
 * Removes heavy coordinate arrays, speedLimit data, detailed guidance,
 * and verbose charging stop metadata while keeping route summary,
 * charging stop essentials, and energy consumption data.
 */
function trimEVRoutingResponse(response: Routes): Routes {
  if (!response?.features) return response;

  const trimmed = structuredClone(response);

  trimmed.features = trimmed.features.map((feature) => {
    const geom = feature.geometry as { coordinates?: unknown[]; type?: string } | undefined;
    if (geom?.coordinates) {
      const coords = geom.coordinates;
      if (Array.isArray(coords) && coords.length > 2) {
        geom.coordinates = [coords[0], coords[coords.length - 1]];
      }
    }

    const props = (feature.properties ?? {}) as Record<string, unknown>;

    // Strip sections down to only agent-useful ones: leg (charging stops), country, toll
    const sections = props.sections as Record<string, unknown> | undefined;
    if (sections) {
      const { leg, country, toll } = sections;
      props.sections = {
        ...(leg ? { leg } : {}),
        ...(country ? { country } : {}),
        ...(toll ? { toll } : {}),
      };

      // Trim charging info inside leg summaries
      const updatedSections = props.sections as Record<string, unknown>;
      if (Array.isArray(updatedSections.leg)) {
        updatedSections.leg = (updatedSections.leg as LegItem[]).map((legItem: LegItem) => {
          const ci = legItem.summary?.chargingInformationAtEndOfLeg;
          if (ci) {
            legItem.summary!.chargingInformationAtEndOfLeg = trimChargingInfo(ci);
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
function trimChargingInfo(info: ChargingInfo): ChargingInfo {
  if (!info) return info;

  // Charging info is a GeoJSON Feature with point geometry
  const p = info.properties ?? {};
  return {
    type: "Feature",
    geometry: info.geometry,
    properties: {
      chargingParkName: p.chargingParkName,
      chargingParkPowerInkW: p.chargingParkPowerInkW,
      chargingTimeInSeconds: p.chargingTimeInSeconds,
      targetChargeInkWh: p.targetChargeInkWh,
      ...(p.address?.freeformAddress
        ? { address: { freeformAddress: p.address.freeformAddress } }
        : {}),
    },
  };
}

/**
 * Create handler for Long Distance EV Routing tool.
 */
export function createEVRoutingHandler() {
  return async (params: Record<string, unknown>) => {
    logger.info("EV route calculation");
    try {
      const { show_ui = true, response_detail = "compact", ...routeParams } = params;

      const result = await calculateEVRoute(
        routeParams as unknown as Parameters<typeof calculateEVRoute>[0]
      );

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
      return await buildCompressedResponse(trimmed, result, show_ui as boolean);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "EV route calculation failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}
