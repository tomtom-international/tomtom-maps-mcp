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

/**
 * Route calculation for the `routePlans` of `tomtom-dynamic-map`.
 *
 * Calls the Routing REST API directly rather than the Maps SDK so that every
 * travel mode the schema accepts (car, truck, bicycle, pedestrian) is honoured
 * when drawing routes on the rendered map.
 */

import { tomtomClient, validateApiKey, API_VERSION } from "../base/tomtomClient";
import { handleApiError } from "../../utils/apiErrorHandler";
import { logger } from "../../utils/logger";
import { IncorrectError } from "../../types/types";
import type { Coordinates, RouteResult, RouteOptions } from "../routing/types";

function buildRouteParams(options?: RouteOptions): Record<string, unknown> {
  const params: Record<string, unknown> = {
    computeTravelTimeFor: options?.computeTravelTimeFor || "all",
    routeType: options?.routeType || "fastest",
  };

  if (!options) return params;

  if (options.traffic !== undefined) params.traffic = options.traffic;
  if (options.departAt) params.departAt = options.departAt;
  else if (options.arriveAt) params.arriveAt = options.arriveAt;

  if (options.travelMode) params.travelMode = options.travelMode;
  if (options.avoid) params.avoid = options.avoid;
  if (options.sectionType) params.sectionType = options.sectionType;

  if (options.vehicleMaxSpeed) params.vehicleMaxSpeed = options.vehicleMaxSpeed;
  if (options.vehicleWeight) params.vehicleWeight = options.vehicleWeight;
  if (options.vehicleWidth) params.vehicleWidth = options.vehicleWidth;
  if (options.vehicleHeight) params.vehicleHeight = options.vehicleHeight;
  if (options.vehicleLength) params.vehicleLength = options.vehicleLength;
  if (options.vehicleCommercial !== undefined) params.vehicleCommercial = options.vehicleCommercial;
  if (options.vehicleAxleWeight) params.vehicleAxleWeight = options.vehicleAxleWeight;
  if (options.vehicleLoadType) params.vehicleLoadType = options.vehicleLoadType;
  if (options.vehicleNumberOfAxles) params.vehicleNumberOfAxles = options.vehicleNumberOfAxles;
  if (options.vehicleAdrTunnelRestrictionCode) {
    params.vehicleAdrTunnelRestrictionCode = options.vehicleAdrTunnelRestrictionCode;
  }

  if (options.maxAlternatives) params.maxAlternatives = options.maxAlternatives;
  if (options.alternativeType) params.alternativeType = options.alternativeType;
  if (options.minDeviationDistance) params.minDeviationDistance = options.minDeviationDistance;
  if (options.minDeviationTime) params.minDeviationTime = options.minDeviationTime;

  if (options.language) params.language = options.language;
  if (options.instructionsType) params.instructionsType = options.instructionsType;

  if (options.includeTollPaymentTypes !== undefined) {
    params.includeTollPaymentTypes = options.includeTollPaymentTypes;
  }

  if (options.computeBestOrder !== undefined) params.computeBestOrder = options.computeBestOrder;
  if (options.supportingPoints) params.supportingPoints = options.supportingPoints;
  if (options.supportingPointIndexOfOrigin !== undefined) {
    params.supportingPointIndexOfOrigin = options.supportingPointIndexOfOrigin;
  }
  if (options.vehicleHeading !== undefined) params.vehicleHeading = options.vehicleHeading;

  if (options.vehicleEngineType) params.vehicleEngineType = options.vehicleEngineType;
  if (options.constantSpeedConsumptionInkWhPerHundredkm) {
    params.constantSpeedConsumptionInkWhPerHundredkm =
      options.constantSpeedConsumptionInkWhPerHundredkm;
  }
  if (options.currentChargeInkWh !== undefined)
    params.currentChargeInkWh = options.currentChargeInkWh;
  if (options.maxChargeInkWh !== undefined) params.maxChargeInkWh = options.maxChargeInkWh;
  if (options.minChargeAtDestinationInkWh !== undefined) {
    params.minChargeAtDestinationInkWh = options.minChargeAtDestinationInkWh;
  }
  if (options.minChargeAtChargingStopsInkWh !== undefined) {
    params.minChargeAtChargingStopsInkWh = options.minChargeAtChargingStopsInkWh;
  }
  if (options.auxiliaryPowerInkW !== undefined)
    params.auxiliaryPowerInkW = options.auxiliaryPowerInkW;
  if (options.chargeMarginsInkWh) params.chargeMarginsInkWh = options.chargeMarginsInkWh;

  if (options.constantSpeedConsumptionInLitersPerHundredkm) {
    params.constantSpeedConsumptionInLitersPerHundredkm =
      options.constantSpeedConsumptionInLitersPerHundredkm;
  }
  if (options.currentFuelInLiters !== undefined)
    params.currentFuelInLiters = options.currentFuelInLiters;
  if (options.auxiliaryPowerInLitersPerHour !== undefined) {
    params.auxiliaryPowerInLitersPerHour = options.auxiliaryPowerInLitersPerHour;
  }
  if (options.fuelEnergyDensityInMJoulesPerLiter !== undefined) {
    params.fuelEnergyDensityInMJoulesPerLiter = options.fuelEnergyDensityInMJoulesPerLiter;
  }

  if (options.accelerationEfficiency !== undefined)
    params.accelerationEfficiency = options.accelerationEfficiency;
  if (options.decelerationEfficiency !== undefined)
    params.decelerationEfficiency = options.decelerationEfficiency;
  if (options.uphillEfficiency !== undefined) params.uphillEfficiency = options.uphillEfficiency;
  if (options.downhillEfficiency !== undefined)
    params.downhillEfficiency = options.downhillEfficiency;
  if (options.consumptionInkWhPerkmAltitudeGain !== undefined) {
    params.consumptionInkWhPerkmAltitudeGain = options.consumptionInkWhPerkmAltitudeGain;
  }
  if (options.recuperationInkWhPerkmAltitudeLoss !== undefined) {
    params.recuperationInkWhPerkmAltitudeLoss = options.recuperationInkWhPerkmAltitudeLoss;
  }

  if (options.report !== undefined) params.report = options.report;
  if (options.routeRepresentation) params.routeRepresentation = options.routeRepresentation;
  if (options.extendedRouteRepresentation)
    params.extendedRouteRepresentation = options.extendedRouteRepresentation;
  if (options.enhancedNarrative !== undefined) params.enhancedNarrative = options.enhancedNarrative;

  if (options.hilliness) params.hilliness = options.hilliness;
  if (options.windingness) params.windingness = options.windingness;
  if (options.timeConsideration) params.timeConsideration = options.timeConsideration;
  if (options.routeVehicleType) params.routeVehicleType = options.routeVehicleType;
  if (options.callback) params.callback = options.callback;

  return params;
}

export async function getRoute(
  origin: Coordinates,
  destination: Coordinates,
  options?: RouteOptions
): Promise<RouteResult> {
  try {
    validateApiKey();
    logger.debug(
      {
        origin: { lat: origin.lat, lon: origin.lon },
        destination: { lat: destination.lat, lon: destination.lon },
      },
      "Calculating route"
    );

    const coordinates = `${origin.lat},${origin.lon}:${destination.lat},${destination.lon}`;
    const params = buildRouteParams(options);
    const response = await tomtomClient.get(
      `/routing/${API_VERSION.ROUTING}/calculateRoute/${coordinates}/json`,
      { params }
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error);
  }
}

export async function getMultiWaypointRoute(
  waypoints: Coordinates[],
  options?: RouteOptions
): Promise<RouteResult> {
  try {
    validateApiKey();

    if (waypoints.length < 2) {
      throw new IncorrectError("At least two waypoints (origin and destination) are required", {
        waypoint_count: waypoints.length,
        minimum_required: 2,
      });
    }

    logger.debug({ waypoint_count: waypoints.length }, "Calculating multi-waypoint route");

    const coordinates = waypoints.map((point) => `${point.lat},${point.lon}`).join(":");
    const params = buildRouteParams(options);
    const response = await tomtomClient.get(
      `/routing/${API_VERSION.ROUTING}/calculateRoute/${coordinates}/json`,
      { params }
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error);
  }
}
