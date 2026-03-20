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
 * Long Distance EV Routing SDK Service
 * Uses TomTom Maps SDK calculateRoute() with electric vehicle parameters
 * for routes that include automatic charging stop planning.
 */

import { calculateRoute } from "@tomtom-org/maps-sdk/services";
import { getEffectiveApiKey } from "../base/tomtomClient";
import { logger } from "../../utils/logger";

export interface EVRoutingParams {
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number };
  waypoints?: Array<{ lat: number; lon: number }>;
  currentChargePercent: number;
  maxChargeKWH: number;
  consumptionInKWH?: Array<{ speedKMH: number; consumptionUnitsPer100KM: number }>;
  batteryCurve?: Array<{ stateOfChargeInkWh: number; maxPowerInkW: number }>;
  minChargeAtDestinationPercent?: number;
  minChargeAtChargingStopsPercent?: number;
  routeType?: "fast" | "short" | "efficient";
  traffic?: "live" | "historical";
  avoid?: string[];
  departAt?: string;
  language?: string;
}

/**
 * Calculate a long distance EV route with automatic charging stop planning.
 *
 * Uses SDK's calculateRoute() with vehicle.engineType = 'electric' and
 * charging preferences to automatically insert optimal charging stops.
 *
 * @param params EV routing parameters
 * @returns SDK Routes (GeoJSON FeatureCollection with route geometry and charging stops)
 */
export async function calculateEVRoute(params: EVRoutingParams): Promise<any> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error("API key not available");

  logger.debug(
    {
      origin: params.origin,
      destination: params.destination,
      chargePercent: params.currentChargePercent,
      maxChargeKWH: params.maxChargeKWH,
    },
    "Calculating EV route via SDK"
  );

  // Build locations array: origin + waypoints + destination
  // SDK expects [lng, lat] tuples (HasLngLat format)
  const locations: Array<[number, number]> = [[params.origin.lon, params.origin.lat]];

  if (params.waypoints) {
    for (const wp of params.waypoints) {
      locations.push([wp.lon, wp.lat]);
    }
  }

  locations.push([params.destination.lon, params.destination.lat]);

  // Build vehicle model following SDK's ExplicitVehicleModel<'electric'> structure.
  // See: examples/ldevr-detailed-vehicle/src/vehicleParams.ts
  //
  // Default connectors matching the working SDK example format exactly.
  // The SDK validates connector shape strictly (plugTypes must use underscores,
  // efficiency and baseLoadInkW are required).
  const defaultConnectors = [
    {
      currentType: "AC3" as const,
      plugTypes: [
        "IEC_62196_Type_2_Outlet",
        "IEC_62196_Type_2_Connector_Cable_Attached",
        "Combo_to_IEC_62196_Type_2_Base",
      ],
      efficiency: 0.9,
      baseLoadInkW: 0.2,
      maxPowerInkW: 11,
    },
    {
      currentType: "DC" as const,
      plugTypes: [
        "IEC_62196_Type_2_Outlet",
        "IEC_62196_Type_2_Connector_Cable_Attached",
        "Combo_to_IEC_62196_Type_2_Base",
      ],
      voltageRange: { minVoltageInV: 0, maxVoltageInV: 500 },
      efficiency: 0.9,
      baseLoadInkW: 0.2,
      maxPowerInkW: 150,
    },
  ];

  const defaultBatteryCurve = [
    { stateOfChargeInkWh: 50, maxPowerInkW: 200 },
    { stateOfChargeInkWh: 70, maxPowerInkW: 100 },
    { stateOfChargeInkWh: 80, maxPowerInkW: 40 },
  ];

  const charging: any = {
    maxChargeKWH: params.maxChargeKWH,
    batteryCurve: params.batteryCurve || defaultBatteryCurve,
    chargingConnectors: defaultConnectors,
    chargingTimeOffsetInSec: 60,
  };

  // Consumption model — required for charging stop calculation
  const consumption: any = {
    speedsToConsumptionsKWH: params.consumptionInKWH || [
      { speedKMH: 32, consumptionUnitsPer100KM: 10.87 },
      { speedKMH: 77, consumptionUnitsPer100KM: 18.01 },
    ],
  };

  // Build SDK CalculateRouteParams with correct nested structure
  const routeParams: any = {
    apiKey,
    locations,
    vehicle: {
      engineType: "electric" as const,
      state: {
        currentChargePCT: params.currentChargePercent,
      },
      preferences: {
        chargingPreferences: {
          minChargeAtDestinationPCT: params.minChargeAtDestinationPercent ?? 20,
          minChargeAtChargingStopsPCT: params.minChargeAtChargingStopsPercent ?? 10,
        },
      },
      model: {
        engine: {
          charging,
          consumption,
        },
      },
    },
  };

  // Route options
  if (params.routeType) routeParams.routeType = params.routeType;
  if (params.traffic) routeParams.traffic = params.traffic;
  if (params.avoid) routeParams.avoid = params.avoid;
  if (params.departAt) routeParams.departAt = params.departAt;
  if (params.language) routeParams.language = params.language;

  // Call SDK calculateRoute
  const routes = await calculateRoute(routeParams);

  logger.debug({ routeCount: routes.features?.length }, "EV route calculation completed");

  return routes;
}
