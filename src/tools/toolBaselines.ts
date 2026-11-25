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

// Test fixture: valid arguments for every tool that calls a TomTom API, which
// cannedApiResponse answers offline.

export type ToolArguments = Record<string, unknown>;

export const AMSTERDAM = [4.9, 52.37];
export const UTRECHT = [5.12, 52.09];

export const API_TOOLS: Record<string, ToolArguments> = {
  "tomtom-discover-places": { query: "coffee" },
  "tomtom-locate-place": { query: "Amsterdam" },
  "tomtom-reverse-geocode": { position: AMSTERDAM },
  "tomtom-poi-categories": {},
  "tomtom-plan-route": { locations: [{ position: AMSTERDAM }, { position: UTRECHT }] },
  "tomtom-get-traffic": { where: { mode: "within", boundingBox: [4.8, 52.3, 4.95, 52.4] } },
};

// Tools that call no TomTom API, or only to draw: their inputs are checked elsewhere.
export const NOT_API_TOOLS = new Set([
  "tomtom-dynamic-map",
  "tomtom-data-viz",
  "tomtom-get-api-key",
  "tomtom-get-app-config",
  "tomtom-get-app-data",
  "tomtom-report-app-status",
  "tomtom-describe-dataset",
  "tomtom-analyse-datasets",
  "tomtom-derive-datasets",
]);

export const TOOL_CALLS_REACHING_TOMTOM: ReadonlyArray<[string, ToolArguments]> = [
  ...Object.entries(API_TOOLS),
  [
    "tomtom-dynamic-map",
    { routePlans: [{ origin: { lat: 52.37, lon: 4.9 }, destination: { lat: 52.09, lon: 5.12 } }] },
  ],
];

// The maps-sdk caches POI categories for the whole process, so only the first lookup sends a request
export const CACHED_AFTER_FIRST_CALL = new Set(["tomtom-poi-categories"]);
