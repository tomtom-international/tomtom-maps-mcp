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
 * `map-agent-adapter.ts`. Every model-visible tool has an entry, which
 * `build-tools.test.ts` asserts.
 *
 * Shapes mirror what the real tools return (a trimmed FeatureCollection plus
 * `show_ui` and the tool name) so a model that reads the result and decides to chain into
 * another tool behaves the way it would in production.
 */

/** What the server adds to the text of a result that has app data. */
const shown = (tool: string) => ({ show_ui: true, tool });

const place = (name: string, lon: number, lat: number) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lon, lat] },
  properties: { poi: { name }, address: { freeformAddress: `${name}, Amsterdam` } },
});

export const SPECIFIC_MOCKS: Record<string, unknown> = {
  "tomtom-locate-place": {
    type: "FeatureCollection",
    features: [place("Dam Square", 4.8932, 52.3731)],
    ...shown("tomtom-locate-place"),
  },
  "tomtom-reverse-geocode": {
    type: "Feature",
    geometry: { type: "Point", coordinates: [4.8994, 52.3791] },
    properties: { address: { freeformAddress: "Nieuwmarkt 1, Amsterdam" } },
    ...shown("tomtom-reverse-geocode"),
  },
  "tomtom-discover-places": {
    type: "FeatureCollection",
    features: [place("Trattoria Vasso", 4.8845, 52.3663), place("Toscanini", 4.8836, 52.3782)],
    searched: { mode: "within", scope: "Amsterdam, Netherlands" },
    ...shown("tomtom-discover-places"),
  },
  "tomtom-poi-categories": {
    categories: [
      { code: "ITALIAN_RESTAURANT", name: "Italian Restaurant" },
      { code: "CHARGING_LOCATION", name: "Charging Location" },
      { code: "FUEL_STATION", name: "Fuel Station" },
    ],
    show_ui: false,
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
    ...shown("tomtom-plan-route"),
  },
  "tomtom-get-traffic": {
    incidents: [
      {
        category: "jam",
        magnitudeOfDelay: "major",
        from: "A10 exit S103",
        to: "A10 exit S104",
        delayInSeconds: 480,
      },
      {
        category: "roadworks",
        magnitudeOfDelay: "moderate",
        from: "N200",
        to: "A10",
        delayInSeconds: 120,
      },
    ],
    ...shown("tomtom-get-traffic"),
  },
  "tomtom-dynamic-map": "Dynamic map ready (800x600, layers: markers)",
  "tomtom-data-viz": {
    summary: {
      kind: "byod",
      count: 5000,
      geometryTypes: ["Point"],
      bbox: [4.7, 52.3, 5.0, 52.4],
      properties: {
        district: {
          type: "string",
          present: 500,
          distinct: 3,
          values: ["Centrum", "Noord", "Zuid"],
        },
        population: { type: "number", present: 500, distinct: 64, distinctTruncated: true },
      },
      sampledFrom: 500,
      sample: [
        { district: "Centrum", population: 1200 },
        { district: "Noord", population: 950 },
      ],
    },
    layers_applied: ["clusters"],
    ...shown("tomtom-data-viz"),
  },
};
