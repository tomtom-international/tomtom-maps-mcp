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
 *
 * Place names and where they really are, for the locate ranking test. The
 * positions are the places', not what the API answered; `landmarks.json` holds
 * the recorded answers (`scripts/record-place-fixtures.ts`).
 */

import type { Position } from "geojson";

export interface Landmark {
  query: string;
  /** [longitude, latitude] of the place itself. */
  at: Position;
  /** How far from `at` a correct answer may lie: a venue's entrance, an area's centre. */
  withinMeters: number;
}

const venue = (query: string, at: Position): Landmark => ({ query, at, withinMeters: 600 });
const area = (query: string, at: Position, withinMeters: number): Landmark => ({
  query,
  at,
  withinMeters,
});

export const LANDMARKS: Landmark[] = [
  venue("Sagrada Família, Barcelona", [2.1744, 41.4036]),
  venue("Times Square, New York", [-73.9855, 40.758]),
  venue("Dam Square, Amsterdam", [4.893, 52.3731]),
  { ...venue("Schiphol Airport", [4.7639, 52.3105]), withinMeters: 2500 },
  venue("Amsterdam Centraal", [4.9003, 52.3789]),
  venue("Eiffel Tower, Paris", [2.2945, 48.8584]),
  venue("Rijksmuseum, Amsterdam", [4.8852, 52.36]),
  area("Damrak 1, Amsterdam", [4.8963, 52.3769], 300),
  area("Westminster, London", [-0.1357, 51.4975], 3000),
  venue("Brandenburger Tor", [13.3777, 52.5163]),
  venue("Hauptbahnhof, Berlin", [13.3695, 52.5251]),
  venue("Colosseum, Rome", [12.4922, 41.8902]),
  venue("Big Ben, London", [-0.1246, 51.5007]),
  venue("Central Station, Amsterdam", [4.9003, 52.3789]),
  { ...venue("Statue of Liberty, New York", [-74.0445, 40.6892]), withinMeters: 1500 },
  venue("Louvre, Paris", [2.3376, 48.8606]),
  { ...venue("Vondelpark, Amsterdam", [4.8686, 52.358]), withinMeters: 1200 },
  { ...venue("Golden Gate Bridge, San Francisco", [-122.4783, 37.8199]), withinMeters: 1500 },
  { ...venue("Heathrow Airport", [-0.4543, 51.47]), withinMeters: 3000 },
  venue("Sydney Opera House", [151.2153, -33.8568]),
  venue("Anne Frank House, Amsterdam", [4.884, 52.3752]),
  venue("Notre-Dame, Paris", [2.3499, 48.853]),
  venue("Alexanderplatz, Berlin", [13.4132, 52.5219]),
  area("Kreuzberg, Berlin", [13.403, 52.497], 3000),
  area("Utrecht", [5.1214, 52.0907], 3000),
  // The city, not the Legoland ride of that name that also matches exactly.
  area("Frankfurt", [8.6821, 50.1109], 10000),
  // The address, not the street it is on.
  area("Prinsengracht 263, Amsterdam", [4.884, 52.3752], 150),
  area("Den Bosch", [5.3037, 51.6978], 5000),
  { ...venue("Stelvio Pass", [10.4528, 46.5287]), withinMeters: 2000 },
  // The town in South Tyrol, not the hamlet near Aosta: the search labels the
  // town's country "Italia" and the hamlet's "Italy".
  area("Merano, Italy", [11.1594, 46.6713], 5000),
];
