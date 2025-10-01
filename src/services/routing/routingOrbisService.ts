/*
 * Copyright (C) 2025 TomTom NV
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

import { tomtomClient, validateApiKey, ORBIS_API_VERSION } from "../base/tomtomClient";
import { handleApiError } from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
import {
  Coordinates,
  RouteResult,
  RouteOptionsOrbis,
  ReachableRangeOptionsOrbis,
  ReachableRangeResult,
} from "./types";

/**
 * Helper function to build route parameters from options
 * Centralizes parameter mapping logic to avoid duplication
 */
function buildRouteParams(options?: RouteOptionsOrbis): Record<string, any> {
  const params: Record<string, any> = {
    apiVersion: ORBIS_API_VERSION.ROUTING,
    computeTravelTimeFor: options?.computeTravelTimeFor || "all",
    routeType: options?.routeType || "fast", // Changed from "fastest" to "fast" for Orbis
  };

  if (!options) return params;

  // Traffic and timing options
  if (options.traffic !== undefined) params.traffic = options.traffic;
  if (options.departAt) params.departAt = options.departAt;
  else if (options.arriveAt) params.arriveAt = options.arriveAt;

  // Basic route options
  if (options.travelMode) params.travelMode = options.travelMode;
  if (options.avoid) params.avoid = options.avoid;
  if (options.sectionType) params.sectionType = options.sectionType;

  // Vehicle specifications
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

  // Alternative routes
  if (options.maxAlternatives) params.maxAlternatives = options.maxAlternatives;
  if (options.alternativeType) params.alternativeType = options.alternativeType;
  if (options.minDeviationDistance) params.minDeviationDistance = options.minDeviationDistance;
  if (options.minDeviationTime) params.minDeviationTime = options.minDeviationTime;

  // Language and instruction options
  if (options.language) params.language = options.language;
  if (options.instructionsType) params.instructionsType = options.instructionsType;

  // Display options
  if (options.includeTollPaymentTypes !== undefined) {
    params.includeTollPaymentTypes = options.includeTollPaymentTypes;
  }

  // Waypoint optimization
  if (options.computeBestOrder !== undefined) params.computeBestOrder = options.computeBestOrder;
  if (options.supportingPoints) params.supportingPoints = options.supportingPoints;
  if (options.supportingPointIndexOfOrigin !== undefined) {
    params.supportingPointIndexOfOrigin = options.supportingPointIndexOfOrigin;
  }
  if (options.vehicleHeading !== undefined) params.vehicleHeading = options.vehicleHeading;

  // EV routing options
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

  // Combustion vehicle options
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

  // Efficiency parameters
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

  // Report and representation options
  if (options.report !== undefined) params.report = options.report;
  if (options.routeRepresentation) params.routeRepresentation = options.routeRepresentation;
  if (options.extendedRouteRepresentation)
    params.extendedRouteRepresentation = options.extendedRouteRepresentation;
  if (options.enhancedNarrative !== undefined) params.enhancedNarrative = options.enhancedNarrative;

  // Other preferences
  if (options.hilliness) params.hilliness = options.hilliness;
  if (options.windingness) params.windingness = options.windingness;
  if (options.timeConsideration) params.timeConsideration = options.timeConsideration;
  if (options.routeVehicleType) params.routeVehicleType = options.routeVehicleType;
  if (options.callback) params.callback = options.callback;

  return params;
}

/**
 * Calculate a route between two points with various options
 * @param origin Starting point coordinates
 * @param destination Ending point coordinates
 * @param options Various routing options
 * @returns Detailed routing information
 */
export async function getRoute(
  origin: Coordinates,
  destination: Coordinates,
  options?: RouteOptionsOrbis
): Promise<RouteResult> {
  try {
    validateApiKey();
    logger.debug(
      `Calculating route from (${origin.lat}, ${origin.lon}) to (${destination.lat}, ${destination.lon})`
    );

    // Format coordinates for URL path (not query params)
    const coordinates = `${origin.lat},${origin.lon}:${destination.lat},${destination.lon}`;
    const params = buildRouteParams(options);
    // Use the correct URL structure with coordinates in path and /json format
    const response = await tomtomClient.get(
      `/maps/orbis/routing/calculateRoute/${coordinates}/json`,
      { params }
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Calculate a multi-waypoint route
 * @param waypoints Array of coordinates representing the waypoints in order
 * @param options Various routing options
 * @returns Detailed routing information
 */
export async function getMultiWaypointRoute(
  waypoints: Coordinates[],
  options?: RouteOptionsOrbis
): Promise<RouteResult> {
  try {
    validateApiKey();

    if (waypoints.length < 2) {
      throw new Error("At least two waypoints (origin and destination) are required");
    }

    logger.debug(`Calculating multi-waypoint route with ${waypoints.length} points`);

    // Format coordinates for URL path (not query params)
    const coordinates = waypoints.map((point) => `${point.lat},${point.lon}`).join(":");

    const params = buildRouteParams(options);

    // Use the correct URL structure with coordinates in path and /json format
    const response = await tomtomClient.get(
      `/maps/orbis/routing/calculateRoute/${coordinates}/json`,
      { params }
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Helper function to build reachable range parameters from options
 * Centralizes parameter mapping logic to avoid duplication
 */
function buildReachableRangeParams(options: ReachableRangeOptionsOrbis): Record<string, any> {
  const params: Record<string, any> = {
    apiVersion: ORBIS_API_VERSION.ROUTING,
  };

  // Budget parameters (one required)
  if (options.timeBudgetInSec !== undefined) params.timeBudgetInSec = options.timeBudgetInSec;
  if (options.distanceBudgetInMeters !== undefined)
    params.distanceBudgetInMeters = options.distanceBudgetInMeters;
  if (options.energyBudgetInkWh !== undefined) params.energyBudgetInkWh = options.energyBudgetInkWh;
  if (options.fuelBudgetInLiters !== undefined)
    params.fuelBudgetInLiters = options.fuelBudgetInLiters;

  // Basic routing options
  if (options.routeType) params.routeType = options.routeType;
  if (options.travelMode) params.travelMode = options.travelMode;
  if (options.traffic) params.traffic = options.traffic;
  if (options.avoid) params.avoid = options.avoid;
  if (options.departAt) params.departAt = options.departAt;

  // Vehicle specifications
  if (options.vehicleMaxSpeed) params.vehicleMaxSpeed = options.vehicleMaxSpeed;
  if (options.vehicleWeight) params.vehicleWeight = options.vehicleWeight;

  // Vehicle engine parameters
  if (options.vehicleEngineType) params.vehicleEngineType = options.vehicleEngineType;

  // Electric vehicle options
  if (options.constantSpeedConsumptionInkWhPerHundredkm) {
    params.constantSpeedConsumptionInkWhPerHundredkm =
      options.constantSpeedConsumptionInkWhPerHundredkm;
  }
  if (options.currentChargeInkWh !== undefined)
    params.currentChargeInkWh = options.currentChargeInkWh;
  if (options.maxChargeInkWh !== undefined) params.maxChargeInkWh = options.maxChargeInkWh;
  if (options.auxiliaryPowerInkW !== undefined)
    params.auxiliaryPowerInkW = options.auxiliaryPowerInkW;

  // Combustion vehicle options
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

  // Efficiency parameters
  if (options.accelerationEfficiency !== undefined) {
    params.accelerationEfficiency = options.accelerationEfficiency;
  }
  if (options.decelerationEfficiency !== undefined) {
    params.decelerationEfficiency = options.decelerationEfficiency;
  }
  if (options.uphillEfficiency !== undefined) params.uphillEfficiency = options.uphillEfficiency;
  if (options.downhillEfficiency !== undefined)
    params.downhillEfficiency = options.downhillEfficiency;
  if (options.consumptionInkWhPerkmAltitudeGain !== undefined) {
    params.consumptionInkWhPerkmAltitudeGain = options.consumptionInkWhPerkmAltitudeGain;
  }
  if (options.recuperationInkWhPerkmAltitudeLoss !== undefined) {
    params.recuperationInkWhPerkmAltitudeLoss = options.recuperationInkWhPerkmAltitudeLoss;
  }

  // Other options
  if (options.report !== undefined) params.report = options.report;
  if (options.hilliness) params.hilliness = options.hilliness;
  if (options.windingness) params.windingness = options.windingness;

  return params;
}

/**
 * Calculate reachable range from a starting point with various options
 * @param origin Starting point coordinates
 * @param options Various routing and budget options
 * @returns Detailed reachable range information
 */
export async function getReachableRange(
  origin: Coordinates,
  options: ReachableRangeOptionsOrbis
): Promise<ReachableRangeResult> {
  try {
    validateApiKey();

    // Validate that at least one budget parameter is provided
    if (
      options.timeBudgetInSec === undefined &&
      options.distanceBudgetInMeters === undefined &&
      options.energyBudgetInkWh === undefined &&
      options.fuelBudgetInLiters === undefined
    ) {
      throw new Error(
        "At least one budget parameter (time, distance, energy, or fuel) must be provided"
      );
    }

    logger.debug(`Calculating reachable range from (${origin.lat}, ${origin.lon})`);

    // Format origin coordinates for URL path
    const originCoords = `${origin.lat},${origin.lon}`;

    const params = buildReachableRangeParams(options);

    // Use the correct URL structure for Orbis reachable range endpoint
    const response = await tomtomClient.get(
      `/maps/orbis/routing/calculateReachableRange/${originCoords}/json`,
      { params }
    );

    return response.data;
  } catch (error) {
    throw handleApiError(error);
  }
}
