/*
 * Copyright (C) 2026 TomTom Navigation B.V.
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

import type { Position } from "geojson";

// Test fixture: minimal TomTom API responses the maps-sdk parsers accept, so
// offline tests can run whole tool calls, follow-up requests included.

const amsterdam: Position = [4.89707, 52.377956];
const utrecht: Position = [5.12142, 52.090737];

const routeResponse = {
  formatVersion: "0.0.12",
  routes: [
    {
      summary: {
        lengthInMeters: 45000,
        travelDurationInSeconds: 2700,
        trafficDelayDurationInSeconds: 0,
        trafficLengthInMeters: 0,
        departureTime: "2026-09-24T10:00:00+02:00",
        arrivalTime: "2026-09-24T10:45:00+02:00",
      },
      legs: [
        {
          summary: {
            lengthInMeters: 45000,
            travelDurationInSeconds: 2700,
            departureTime: "2026-09-24T10:00:00+02:00",
            arrivalTime: "2026-09-24T10:45:00+02:00",
          },
          path: { type: "LineString", coordinates: [amsterdam, [5.0, 52.2], utrecht] },
        },
      ],
      sections: {},
    },
  ],
};

const searchResponse = {
  summary: {
    query: "coffee",
    queryType: "NON_NEAR",
    queryTime: 10,
    numResults: 1,
    offset: 0,
    totalResults: 1,
    fuzzyLevel: 1,
    queryIntent: [],
  },
  results: [
    {
      type: "POI",
      id: "poi-1",
      score: 1,
      position: { lat: amsterdam[1], lon: amsterdam[0] },
      address: { freeformAddress: "Dam 1, Amsterdam", countryCode: "NL" },
      poi: { name: "Test Place", categories: ["cafe"], classifications: [] },
      chargingPark: {
        connectors: [{ connectorType: "IEC62196Type2CCS", ratedPowerKW: 150, currentType: "DC" }],
      },
    },
  ],
};

/** Places API version 2. */
const reverseGeocodeResponse = {
  results: [
    {
      id: "address-1",
      type: "address",
      title: "Dam 1, Amsterdam",
      position: { type: "Point", coordinates: amsterdam },
      address: {
        countryCodeIso2: "NL",
        municipality: "Amsterdam",
        street: "Dam",
        houseNumber: "1",
      },
    },
  ],
};

const poiCategoriesResponse = {
  poiCategories: [
    { id: 7309, name: "Electric Vehicle Station", childCategoryIds: [], synonyms: [] },
  ],
};

const trafficIncidentsResponse = {
  incidents: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [4.89707, 52.377956],
          [4.9, 52.38],
        ],
      },
      properties: { id: "incident-1", iconCategory: 6, magnitudeOfDelay: 2 },
    },
  ],
};

/** The canned response for a request to `url`. */
export function cannedApiResponse(url: string): unknown {
  if (url.includes("incidentDetails")) return trafficIncidentsResponse;
  if (url.includes("/routing/")) return routeResponse;
  if (url.includes("reverseGeocode")) return reverseGeocodeResponse;
  if (url.includes("poiCategories")) return poiCategoriesResponse;
  return searchResponse;
}
