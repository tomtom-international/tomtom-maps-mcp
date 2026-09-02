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
 * Canned tool results for tool-SELECTION scenarios, so those tests never hit the
 * TomTom API. Same role as `SPECIFIC_MOCKS` in the agent toolkit's
 * `map-agent-adapter.ts`; tools not listed here return `{ success: true }`.
 *
 * Shapes mirror what the real tools return (a trimmed FeatureCollection plus a
 * `_meta.dataset_id`) so a model that reads the result and decides to chain into
 * another tool behaves the way it would in production.
 */

const DATASET_META = { show_ui: true, dataset_id: "ds_evalfixture" };

const place = (name: string, lon: number, lat: number) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lon, lat] },
  properties: { poi: { name }, address: { freeformAddress: `${name}, Amsterdam` } },
});

export const SPECIFIC_MOCKS: Record<string, unknown> = {
  "tomtom-locate-place": {
    type: "FeatureCollection",
    features: [place("Dam Square", 4.8932, 52.3731)],
    _meta: DATASET_META,
  },
  "tomtom-reverse-geocode": {
    type: "Feature",
    geometry: { type: "Point", coordinates: [4.8994, 52.3791] },
    properties: { address: { freeformAddress: "Nieuwmarkt 1, Amsterdam" } },
    _meta: DATASET_META,
  },
  "tomtom-discover-places": {
    type: "FeatureCollection",
    features: [place("Trattoria Vasso", 4.8845, 52.3663), place("Toscanini", 4.8836, 52.3782)],
    searched: { mode: "within", scope: "Amsterdam, Netherlands" },
    _meta: DATASET_META,
  },
  // Not a tool — the EV-shaped fixture, kept for readability of the file.
  "_ev-example": {
    type: "FeatureCollection",
    features: [
      {
        ...place("Fastned Utrecht", 5.1214, 52.0907),
        properties: {
          poi: { name: "Fastned Utrecht" },
          chargingPark: {
            connectors: [{ type: "IEC62196Type2CCS", ratedPowerKW: 175, currentType: "DCFast" }],
            availability: {
              chargingPointAvailability: {
                count: 4,
                statusCounts: { Available: 3, Occupied: 1 },
              },
            },
          },
        },
      },
    ],
    _meta: DATASET_META,
  },
  "tomtom-poi-categories": {
    categories: [
      { code: "ITALIAN_RESTAURANT", name: "Italian Restaurant" },
      { code: "ELECTRIC_VEHICLE_STATION", name: "Electric Vehicle Station" },
      { code: "PETROL_STATION", name: "Petrol Station" },
    ],
    _meta: { show_ui: false },
  },
  "tomtom-plan-route": {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString" },
        properties: {
          summary: {
            lengthInMeters: 654_000,
            travelTimeInSeconds: 23_400,
            trafficDelayInSeconds: 900,
          },
        },
      },
    ],
    _meta: DATASET_META,
  },
  // Not a tool — the EV-shaped route fixture, kept for readability.
  "_ev-route-example": {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString" },
        properties: {
          summary: { lengthInMeters: 812_000, travelTimeInSeconds: 32_100 },
          sections: {
            leg: [
              {
                summary: {
                  chargingInformationAtEndOfLeg: {
                    type: "Feature",
                    properties: {
                      chargingParkName: "Fastned Kaltenkirchen",
                      chargingTimeInSeconds: 1500,
                    },
                  },
                },
              },
            ],
          },
        },
      },
    ],
    _meta: DATASET_META,
  },
  "tomtom-find-reachable-areas": {
    type: "Feature",
    geometry: { type: "Polygon" },
    _meta: DATASET_META,
  },
  "tomtom-get-traffic": {
    incidents: [
      {
        iconCategory: 6,
        magnitudeOfDelay: 3,
        from: "A10 exit S103",
        to: "A10 exit S104",
        delay: 480,
      },
      { iconCategory: 1, magnitudeOfDelay: 2, from: "N200", to: "A10", delay: 120 },
    ],
    _meta: DATASET_META,
  },
  "tomtom-dynamic-map": "Dynamic map ready (800x600, layers: markers)",
  "tomtom-data-viz": {
    summary: {
      feature_count: 5000,
      geometry_types: ["Point"],
      bbox: [4.7, 52.3, 5.0, 52.4],
      property_names: ["district", "population"],
      numeric_properties: ["population"],
    },
    layers_applied: ["clusters"],
    _meta: DATASET_META,
  },
};
