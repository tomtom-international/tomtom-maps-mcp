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

/**
 * Type definitions for TomTom Routing API
 */

/**
 * Geographic coordinates interface
 */
export interface Coordinates {
  lat: number;
  lon: number;
}

/**
 * Routing result interface
 */
export interface RouteResult {
  routes?: Array<{
    summary: {
      lengthInMeters: number;
      travelTimeInSeconds: number;
      trafficDelayInSeconds: number;
      departureTime: string;
      arrivalTime: string;
      noTrafficTravelTimeInSeconds?: number;
      historicTrafficTravelTimeInSeconds?: number;
      liveTrafficIncidentsTravelTimeInSeconds?: number;
      trafficLengthInMeters?: number;
      batteryConsumptionInkWh?: number;
      costFactor?: number; // Eco route cost factor
      fuelConsumptionInLiters?: number; // For eco routing
      tollCosts?: {
        // When toll costs are available
        currency?: string;
        value?: number;
      };
      deviationDistance?: number;
      deviationTime?: number;
      deviationPoint?: {
        latitude: number;
        longitude: number;
      };
      reachableRouteOffsets?: Array<{
        chargeMarginInkWh: number;
        routeOffsetInMeters: number;
        point: {
          latitude: number;
          longitude: number;
        };
        pointIndex: number;
      }>;
    };
    routeReassessments?: Array<{
      batteryConsumptionInkWh?: number;
      reachableRouteOffsets?: Array<{
        chargeMarginInkWh: number;
        routeOffsetInMeters: number;
        point: {
          latitude: number;
          longitude: number;
        };
        pointIndex: number;
      }>;
    }>;
    legs: Array<{
      summary?: {
        // Per-leg summary
        lengthInMeters?: number;
        travelTimeInSeconds?: number;
        trafficDelayInSeconds?: number;
        departureTime?: string;
        arrivalTime?: string;
        noTrafficTravelTimeInSeconds?: number;
        historicTrafficTravelTimeInSeconds?: number;
        liveTrafficIncidentsTravelTimeInSeconds?: number;
        trafficLengthInMeters?: number;
        batteryConsumptionInkWh?: number;
        originalWaypointIndexAtEndOfLeg?: number;
        userDefinedPauseTimeInSeconds?: number;
        entryPointIndexAtEndOfLeg?: number;
      };
      points: Array<{
        latitude: number;
        longitude: number;
        altitude?: number; // Altitude when available
      }>;
      instructions?: Array<{
        routeOffsetInMeters: number;
        travelTimeInSeconds: number;
        point: {
          latitude: number;
          longitude: number;
        };
        message: string;
        instructionType?: string; // For 'coded' instructions
        street?: string; // Street name for the instruction
        maneuver?: string; // Turn type for the instruction
        exit?: number; // Exit number for roundabouts
        duration?: number; // Duration of the instruction segment
        distance?: number; // Distance of the instruction segment
      }>;
      encodedPolyline?: string; // Encoded polyline representation of the route
      encodedPolylinePrecision?: number; // Precision level for the encoded polyline
    }>;
    sections?: Array<{
      // Route sections for sectionType option
      startPointIndex: number;
      endPointIndex: number;
      sectionType: string; // Type of section (toll, motorway, tunnel, etc.)
      travelTimeInSeconds?: number;
    }>;
  }>;
  formatVersion?: string;
}
/**
 * Available options for route calculation
 */
export interface RouteOptions {
  // Basic route options
  routeType?: "fastest" | "shortest" | "eco" | "thrilling";
  travelMode?: "car" | "pedestrian" | "bicycle" | "truck" | "taxi" | "bus" | "van";
  avoid?: string | string[]; // e.g. "tollRoads", "unpavedRoads", "ferries", "carpools", "alreadyUsedRoads"

  // Traffic and timing options
  traffic?: boolean;
  departAt?: string; // ISO DateTime string
  arriveAt?: string; // ISO DateTime string

  // Vehicle specifications (for truck routing)
  vehicleMaxSpeed?: number;
  vehicleWeight?: number; // kg
  vehicleWidth?: number; // m
  vehicleHeight?: number; // m
  vehicleLength?: number; // m
  vehicleCommercial?: boolean;
  vehicleAxleWeight?: number; // kg
  vehicleLoadType?: string;
  vehicleNumberOfAxles?: number; // Number of axles on the vehicle
  vehicleAdrTunnelRestrictionCode?: string; // ADR tunnel restriction code for hazardous materials

  // Alternative routes
  maxAlternatives?: number;
  alternativeType?: "anyRoute" | "betterRoute"; // Type of alternative routes to calculate
  minDeviationTime?: number; // Minimum deviation time for alternative routes
  minDeviationDistance?: number; // Minimum deviation distance for alternative routes

  // Instruction options
  instructionsType?: "coded" | "text" | "tagged";
  language?: string;

  // Display options
  sectionType?: string | string[]; // e.g. "toll", "motorway", "tunnel", "country", "urban"
  includeTollPaymentTypes?: string; // Include payment methods for toll sections

  // Waypoint handling
  computeBestOrder?: boolean; // Reorder waypoints for optimization
  supportingPoints?: string; // Coordinates for via points that influence the route shape
  supportingPointIndexOfOrigin?: number; // Index of the supporting point to use as origin
  vehicleHeading?: number; // Heading of the vehicle in degrees (0-359)

  // EV routing options
  vehicleEngineType?: "combustion" | "electric";
  constantSpeedConsumptionInkWhPerHundredkm?: string; // Speed-to-consumption mappings for electric
  currentChargeInkWh?: number; // Current battery charge for EV routing
  maxChargeInkWh?: number; // Maximum battery capacity for EV routing
  minChargeAtDestinationInkWh?: number; // Minimum required charge at destination
  minChargeAtChargingStopsInkWh?: number; // Minimum required charge at charging stops
  chargeMarginsInkWh?: string; // Comma-separated charge margins in kWh
  auxiliaryPowerInkW?: number; // Auxiliary power consumption in kW for electric vehicles

  // Combustion vehicle specific options
  constantSpeedConsumptionInLitersPerHundredkm?: string; // Speed-to-consumption for combustion
  currentFuelInLiters?: number; // Current fuel level in liters
  auxiliaryPowerInLitersPerHour?: number; // Auxiliary power consumption for combustion vehicles
  fuelEnergyDensityInMJoulesPerLiter?: number; // Fuel energy density

  // Efficiency parameters
  accelerationEfficiency?: number; // Efficiency during acceleration (0-1)
  decelerationEfficiency?: number; // Efficiency during deceleration (0-1)
  uphillEfficiency?: number; // Efficiency during uphill driving (0-1)
  downhillEfficiency?: number; // Efficiency during downhill driving (0-1)
  consumptionInkWhPerkmAltitudeGain?: number; // Energy used per km of altitude gain
  recuperationInkWhPerkmAltitudeLoss?: number; // Energy recovered per km of altitude loss

  // Report options
  report?: boolean; // Include detailed report in the response
  routeRepresentation?: "polyline" | "summaryOnly" | "encodedPolyline" | "none"; // Level of route detail
  extendedRouteRepresentation?: string; // Additional routing data to include
  computeTravelTimeFor?: "all" | "none"; // Calculate travel times
  enhancedNarrative?: boolean; // Include enhanced narrative instructions

  // Other options
  hilliness?: "low" | "normal" | "high"; // Preference for avoiding hills
  windingness?: "low" | "normal" | "high"; // Preference for avoiding winding roads
  timeConsideration?: "auto" | "linear" | "stopAndFixTime"; // How arrival times are calculated
  routeVehicleType?: string; // Vehicle type for better route calculation
  callback?: string; // For JSONP callback functionality
}

export interface RouteOptionsOrbis {
  // Basic route options
  routeType?: "fast" | "short" | "efficient" | "thrilling";
  travelMode?: "car";
  avoid?: string | string[]; // e.g. "tollRoads", "unpavedRoads", "ferries", "carpools", "alreadyUsedRoads"

  // Traffic and timing options
  traffic?: string;
  departAt?: string; // ISO DateTime string
  arriveAt?: string; // ISO DateTime string

  // Vehicle specifications (for truck routing)
  vehicleMaxSpeed?: number;
  vehicleWeight?: number; // kg
  vehicleWidth?: number; // m
  vehicleHeight?: number; // m
  vehicleLength?: number; // m
  vehicleCommercial?: boolean;
  vehicleAxleWeight?: number; // kg
  vehicleLoadType?: string;
  vehicleNumberOfAxles?: number; // Number of axles on the vehicle
  vehicleAdrTunnelRestrictionCode?: string; // ADR tunnel restriction code for hazardous materials

  // Alternative routes
  maxAlternatives?: number;
  alternativeType?: "anyRoute" | "betterRoute"; // Type of alternative routes to calculate
  minDeviationTime?: number; // Minimum deviation time for alternative routes
  minDeviationDistance?: number; // Minimum deviation distance for alternative routes

  // Instruction options
  instructionsType?: "coded" | "text" | "tagged";
  language?: string;

  // Display options
  sectionType?: string | string[]; // e.g. "toll", "motorway", "tunnel", "country", "urban"
  includeTollPaymentTypes?: string; // Include payment methods for toll sections

  // Waypoint handling
  computeBestOrder?: boolean; // Reorder waypoints for optimization
  supportingPoints?: string; // Coordinates for via points that influence the route shape
  supportingPointIndexOfOrigin?: number; // Index of the supporting point to use as origin
  vehicleHeading?: number; // Heading of the vehicle in degrees (0-359)

  // EV routing options
  vehicleEngineType?: "combustion" | "electric";
  constantSpeedConsumptionInkWhPerHundredkm?: string; // Speed-to-consumption mappings for electric
  currentChargeInkWh?: number; // Current battery charge for EV routing
  maxChargeInkWh?: number; // Maximum battery capacity for EV routing
  minChargeAtDestinationInkWh?: number; // Minimum required charge at destination
  minChargeAtChargingStopsInkWh?: number; // Minimum required charge at charging stops
  chargeMarginsInkWh?: string; // Comma-separated charge margins in kWh
  auxiliaryPowerInkW?: number; // Auxiliary power consumption in kW for electric vehicles

  // Combustion vehicle specific options
  constantSpeedConsumptionInLitersPerHundredkm?: string; // Speed-to-consumption for combustion
  currentFuelInLiters?: number; // Current fuel level in liters
  auxiliaryPowerInLitersPerHour?: number; // Auxiliary power consumption for combustion vehicles
  fuelEnergyDensityInMJoulesPerLiter?: number; // Fuel energy density

  // Efficiency parameters
  accelerationEfficiency?: number; // Efficiency during acceleration (0-1)
  decelerationEfficiency?: number; // Efficiency during deceleration (0-1)
  uphillEfficiency?: number; // Efficiency during uphill driving (0-1)
  downhillEfficiency?: number; // Efficiency during downhill driving (0-1)
  consumptionInkWhPerkmAltitudeGain?: number; // Energy used per km of altitude gain
  recuperationInkWhPerkmAltitudeLoss?: number; // Energy recovered per km of altitude loss

  // Report options
  report?: boolean; // Include detailed report in the response
  routeRepresentation?: "polyline" | "summaryOnly" | "encodedPolyline" | "none"; // Level of route detail
  extendedRouteRepresentation?: string; // Additional routing data to include
  computeTravelTimeFor?: "all" | "none"; // Calculate travel times
  enhancedNarrative?: boolean; // Include enhanced narrative instructions

  // Other options
  hilliness?: "low" | "normal" | "high"; // Preference for avoiding hills
  windingness?: "low" | "normal" | "high"; // Preference for avoiding winding roads
  timeConsideration?: "auto" | "linear" | "stopAndFixTime"; // How arrival times are calculated
  routeVehicleType?: string; // Vehicle type for better route calculation
  callback?: string; // For JSONP callback functionality
}
/**
 * Options for calculating reachable range
 */
export interface ReachableRangeOptions {
  // Budget parameters (at least one is required)
  timeBudgetInSec?: number; // Time budget in seconds
  distanceBudgetInMeters?: number; // Distance budget in meters
  energyBudgetInkWh?: number; // Energy budget in kWh for EV
  fuelBudgetInLiters?: number; // Fuel budget in liters for combustion engine

  // Basic routing options
  travelMode?: string; // Travel mode (car, truck)
  routeType?: string; // Route type (fastest, shortest, eco)
  traffic?: boolean; // Consider traffic conditions
  avoid?: string | string[]; // Features to avoid (tollRoads, motorways, etc.)
  maxFerryLengthInMeters?: number; // Maximum ferry length to consider
  departAt?: string; // Departure time (ISO format)
  report?: boolean; // Include report details in response

  // Route preferences
  hilliness?: "low" | "normal" | "high"; // Hilliness preference
  windingness?: "low" | "normal" | "high"; // Windingness preference

  // Vehicle specifications (for truck routing)
  vehicleMaxSpeed?: number; // Max speed in km/h
  vehicleWeight?: number; // Weight in kg
  vehicleWidth?: number; // Width in meters
  vehicleHeight?: number; // Height in meters
  vehicleLength?: number; // Length in meters
  vehicleCommercial?: boolean; // Is commercial vehicle
  vehicleAxleWeight?: number; // Axle weight in kg
  vehicleNumberOfAxles?: number; // Number of axles
  vehicleLoadType?: string; // Load type for hazardous materials
  vehicleAdrTunnelRestrictionCode?: string; // ADR tunnel restriction code

  // Vehicle engine type and parameters
  vehicleEngineType?: "combustion" | "electric"; // Engine type

  // Combustion engine parameters
  constantSpeedConsumptionInLitersPerHundredkm?: string; // Speed-consumption mapping
  currentFuelInLiters?: number; // Current fuel level
  auxiliaryPowerInLitersPerHour?: number; // Aux power consumption
  fuelEnergyDensityInMJoulesPerLiter?: number; // Fuel energy density

  // Electric vehicle parameters
  constantSpeedConsumptionInkWhPerHundredkm?: string; // Speed-consumption mapping
  currentChargeInkWh?: number; // Current battery charge
  maxChargeInkWh?: number; // Maximum battery capacity
  auxiliaryPowerInkW?: number; // Aux power consumption

  // Efficiency parameters
  accelerationEfficiency?: number; // Acceleration efficiency (0-1)
  decelerationEfficiency?: number; // Deceleration efficiency (0-1)
  uphillEfficiency?: number; // Uphill efficiency (0-1)
  downhillEfficiency?: number; // Downhill efficiency (0-1)
  consumptionInkWhPerkmAltitudeGain?: number; // Consumption per km altitude gain
  recuperationInkWhPerkmAltitudeLoss?: number; // Energy recovered per km altitude loss

  // Other options
  callback?: string; // For JSONP callback
}

/**
 * Result from calculating a reachable range
 */
export interface ReachableRangeResult {
  formatVersion: string;
  copyright: string;
  privacy: string;
  reachableRange: {
    center: {
      latitude: number;
      longitude: number;
    };
    boundary: Array<{
      latitude: number;
      longitude: number;
    }>;
    shells?: Array<{
      points: Array<{
        latitude: number;
        longitude: number;
      }>;
      origin: {
        latitude: number;
        longitude: number;
      };
    }>;
  };
  type?: string; // "polygon" or "pointset"
  report?: {
    effectiveSettings?: Array<{
      key: string;
      value: string;
    }>;
  };
}

/**
 * Options for calculating reachable range with Orbis API
 */
export interface ReachableRangeOptionsOrbis {
  // Budget parameters (at least one is required)
  timeBudgetInSec?: number; // Time budget in seconds
  distanceBudgetInMeters?: number; // Distance budget in meters
  energyBudgetInkWh?: number; // Energy budget in kWh for EV
  fuelBudgetInLiters?: number; // Fuel budget in liters for combustion engine

  // Basic routing options
  travelMode?: "car"; // Travel mode (car only for Orbis)
  routeType?: "fast" | "short" | "efficient" | "thrilling"; // Route type (fast, short, efficient, thrilling)
  traffic?: "live" | "historical"; // Consider traffic conditions
  avoid?: string | string[]; // Features to avoid (tollRoads, motorways, etc.)
  departAt?: string; // Departure time (ISO format)
  report?: string; // Report type (effectiveSettings)

  // Route preferences
  hilliness?: "low" | "normal" | "high"; // Hilliness preference
  windingness?: "low" | "normal" | "high"; // Windingness preference

  // Vehicle specifications
  vehicleMaxSpeed?: number; // Max speed in km/h
  vehicleWeight?: number; // Weight in kg

  // Vehicle engine type and parameters
  vehicleEngineType?: "combustion" | "electric"; // Engine type

  // Combustion engine parameters
  constantSpeedConsumptionInLitersPerHundredkm?: string; // Speed-consumption mapping
  currentFuelInLiters?: number; // Current fuel level
  auxiliaryPowerInLitersPerHour?: number; // Aux power consumption
  fuelEnergyDensityInMJoulesPerLiter?: number; // Fuel energy density

  // Electric vehicle parameters
  constantSpeedConsumptionInkWhPerHundredkm?: string; // Speed-consumption mapping
  currentChargeInkWh?: number; // Current battery charge
  maxChargeInkWh?: number; // Maximum battery capacity
  auxiliaryPowerInkW?: number; // Aux power consumption

  // Efficiency parameters
  accelerationEfficiency?: number; // Acceleration efficiency (0-1)
  decelerationEfficiency?: number; // Deceleration efficiency (0-1)
  uphillEfficiency?: number; // Uphill efficiency (0-1)
  downhillEfficiency?: number; // Downhill efficiency (0-1)
  consumptionInkWhPerkmAltitudeGain?: number; // Consumption per km altitude gain
  recuperationInkWhPerkmAltitudeLoss?: number; // Energy recovered per km altitude loss

  // Other options
  callback?: string; // For JSONP callback
}
