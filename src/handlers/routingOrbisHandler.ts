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

import { logger } from "../utils/logger";
import {
  getRoute,
  getReachableRange,
  calculateEVRoute,
} from "../services/routing/routingOrbisService";
import {
  trimRoutingResponse,
  trimReachableRangeResponse,
  buildCompressedResponse,
  Backend,
} from "./shared/responseTrimmer";
import type { Routes } from "@tomtom-org/maps-sdk/core";
import type { Position } from "geojson";
import type {
  RoutingOrbisParams,
  ReachableRangeOrbisParams,
  EvRoutingOrbisParams,
} from "../schemas/routing/routingOrbisSchema";

const BACKEND: Backend = "orbis";

// Handler factory functions
export function createRoutingHandler() {
  return async (params: RoutingOrbisParams) => {
    const { show_ui = true, response_detail = "compact", ...routingParams } = params;
    const locations = routingParams.locations;
    logger.info({ location_count: locations.length }, "🗺️ Route calculation");
    try {
      const result = await getRoute(locations, routingParams as Parameters<typeof getRoute>[1]);
      logger.info("✅ Route calculated successfully");

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return {
          content: [{ text: JSON.stringify(response, null, 2), type: "text" as const }],
        };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimRoutingResponse(result, BACKEND);
      return await buildCompressedResponse(trimmed, result, show_ui);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "❌ Routing failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}

export function createReachableRangeHandler() {
  return async (params: ReachableRangeOrbisParams) => {
    const { show_ui = true, response_detail = "compact", ...rangeParams } = params;
    // Validate that at least one budget parameter is provided
    if (
      !rangeParams.timeBudgetInSec &&
      !rangeParams.distanceBudgetInMeters &&
      !rangeParams.chargeBudgetPercent &&
      !rangeParams.remainingChargeBudgetPercent &&
      !rangeParams.energyBudgetInkWh &&
      !rangeParams.fuelBudgetInLiters
    ) {
      return {
        content: [
          {
            text: "Error: At least one budget parameter (time, distance, energy, or fuel) must be provided",
            type: "text" as const,
          },
        ],
        isError: true,
      };
    }

    const origin = rangeParams.origin;
    logger.info({ origin: { lng: origin[0], lat: origin[1] } }, "🔄 Reachable range calculation");
    try {
      const result = await getReachableRange(
        origin,
        rangeParams as Parameters<typeof getReachableRange>[1]
      );
      logger.info("✅ Reachable range calculated");

      // If full response requested, return without trimming (single content)
      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return {
          content: [{ text: JSON.stringify(response, null, 2), type: "text" as const }],
        };
      }

      // Trimmed for agent, full data cached for Apps
      const trimmed = trimReachableRangeResponse(result, BACKEND);
      return await buildCompressedResponse(trimmed, result, show_ui);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "❌ Reachable range failed");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Long Distance EV Routing
// ---------------------------------------------------------------------------

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

    const sections = props.sections as Record<string, unknown> | undefined;
    if (sections) {
      const { leg, country, toll } = sections;
      props.sections = {
        ...(leg ? { leg } : {}),
        ...(country ? { country } : {}),
        ...(toll ? { toll } : {}),
      };

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

    delete props.progress;

    return feature;
  });

  return trimmed;
}

function trimChargingInfo(info: ChargingInfo): ChargingInfo {
  if (!info) return info;

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

export function createEVRoutingHandler() {
  return async (params: EvRoutingOrbisParams) => {
    logger.info("EV route calculation");
    try {
      const { show_ui = true, response_detail = "compact", ...routeParams } = params;

      const result = await calculateEVRoute(routeParams as Parameters<typeof calculateEVRoute>[0]);

      logger.info({ routeCount: result?.features?.length || 0 }, "EV route calculation completed");

      if (response_detail === "full") {
        const response = { ...result, _meta: { show_ui } };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
        };
      }

      const trimmed = trimEVRoutingResponse(result);
      return await buildCompressedResponse(trimmed, result, show_ui);
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
