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
 * Response Trimmer - Functions to trim API responses for efficient agent consumption.
 *
 * These functions remove verbose fields that are useful for UI visualization but
 * not necessary for agent decision-making, reducing token usage significantly.
 *
 * Each trimmer is designed to be easily modified - just add/remove fields as needed.
 */

/**
 * Trim routing response for agent consumption.
 * Removes large coordinate arrays and guidance instructions.
 *
 * KEPT: summary (distance, time, delays, departure/arrival times), leg summaries, sections
 * REMOVED: points[] (coordinate arrays), guidance (turn-by-turn instructions)
 */
export function trimRoutingResponse(response: any): any {
  if (!response?.routes) return response;

  return {
    formatVersion: response.formatVersion,
    routes: response.routes.map((route: any) => ({
      summary: {
        lengthInMeters: route.summary?.lengthInMeters,
        travelTimeInSeconds: route.summary?.travelTimeInSeconds,
        trafficDelayInSeconds: route.summary?.trafficDelayInSeconds,
        trafficLengthInMeters: route.summary?.trafficLengthInMeters,
        departureTime: route.summary?.departureTime,
        arrivalTime: route.summary?.arrivalTime,
      },
      legs: route.legs?.map((leg: any) => ({
        summary: {
          lengthInMeters: leg.summary?.lengthInMeters,
          travelTimeInSeconds: leg.summary?.travelTimeInSeconds,
          trafficDelayInSeconds: leg.summary?.trafficDelayInSeconds,
          departureTime: leg.summary?.departureTime,
          arrivalTime: leg.summary?.arrivalTime,
        },
        // REMOVED: points[] - large coordinate array for map rendering
      })),
      sections: route.sections?.map((s: any) => ({
        startPointIndex: s.startPointIndex,
        endPointIndex: s.endPointIndex,
        sectionType: s.sectionType,
        travelMode: s.travelMode,
      })),
      // REMOVED: guidance - turn-by-turn instructions (can be very large)
    })),
  };
}

/**
 * Trim search response for agent consumption.
 * Removes verbose POI details and metadata.
 *
 * KEPT: id, type, score, position, essential address fields, POI name/phone/url/categories
 * REMOVED: classifications, openingHours.timeRanges, brands, timeZone, dataSources, matchConfidence
 */
export function trimSearchResponse(response: any): any {
  if (!response) return response;

  const trimmed: any = {};

  // Keep only essential summary fields
  if (response.summary) {
    trimmed.summary = {
      numResults: response.summary.numResults,
      totalResults: response.summary.totalResults,
    };
  }

  // Trim results array
  if (response.results) {
    trimmed.results = response.results.map((result: any) => {
      const trimmedResult: any = {
        id: result.id,
        type: result.type,
        score: result.score,
        position: result.position, // Always keep lat/lon
      };

      // Keep distance if present
      if (result.dist !== undefined) {
        trimmedResult.dist = result.dist;
      }

      // Trim address to essential fields
      if (result.address) {
        trimmedResult.address = {
          freeformAddress: result.address.freeformAddress,
          municipality: result.address.municipality,
          countrySubdivision: result.address.countrySubdivision,
          country: result.address.country,
          postalCode: result.address.postalCode,
        };
      }

      // Trim POI to essential fields
      if (result.poi) {
        trimmedResult.poi = {
          name: result.poi.name,
          categories: result.poi.categories,
        };
        // Keep phone/url if present
        if (result.poi.phone) trimmedResult.poi.phone = result.poi.phone;
        if (result.poi.url) trimmedResult.poi.url = result.poi.url;
        // REMOVED: classifications, openingHours.timeRanges, brands, timeZone
      }

      // REMOVED: matchConfidence, dataSources, entityType, info
      return trimmedResult;
    });
  }

  // Handle reverse geocoding response format
  if (response.addresses) {
    trimmed.addresses = response.addresses.map((addr: any) => ({
      address: {
        freeformAddress: addr.address?.freeformAddress,
        municipality: addr.address?.municipality,
        countrySubdivision: addr.address?.countrySubdivision,
        country: addr.address?.country,
        postalCode: addr.address?.postalCode,
        streetName: addr.address?.streetName,
        streetNumber: addr.address?.streetNumber,
      },
      position: addr.position,
      // REMOVED: mapcodes, boundingBox, matchType
    }));
  }

  return trimmed;
}

/**
 * Trim traffic incidents response for agent consumption.
 * Removes geometry coordinates and verbose metadata.
 *
 * KEPT: id, iconCategory, magnitudeOfDelay, event descriptions, from/to, delay, roadNumbers, times
 * REMOVED: geometry.coordinates, tmc, aci, numberOfReports, lastReportTime, probabilityOfOccurrence
 */
export function trimTrafficResponse(response: any): any {
  if (!response) return response;

  const trimmed: any = {};

  if (response.incidents) {
    trimmed.incidents = response.incidents.map((incident: any) => ({
      type: incident.type,
      // Keep geometry type but NOT the large coordinates array
      geometry: {
        type: incident.geometry?.type,
        // REMOVED: coordinates - large array for map visualization
      },
      properties: {
        id: incident.properties?.id,
        iconCategory: incident.properties?.iconCategory,
        magnitudeOfDelay: incident.properties?.magnitudeOfDelay,
        // Keep only event descriptions
        events: incident.properties?.events?.map((e: any) => ({
          description: e.description,
        })),
        from: incident.properties?.from,
        to: incident.properties?.to,
        delay: incident.properties?.delay,
        length: incident.properties?.length,
        roadNumbers: incident.properties?.roadNumbers,
        startTime: incident.properties?.startTime,
        endTime: incident.properties?.endTime,
        // REMOVED: tmc, aci, numberOfReports, lastReportTime, probabilityOfOccurrence, timeValidity
      },
    }));
  }

  return trimmed;
}
