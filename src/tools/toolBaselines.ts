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
const UTRECHT = [5.12, 52.09];

export const TOOL_BASELINES: Record<string, ToolArguments> = {
  "tomtom-geocode": { query: "Amsterdam" },
  "tomtom-reverse-geocode": { position: AMSTERDAM },
  "tomtom-fuzzy-search": { query: "coffee" },
  "tomtom-poi-search": { query: "coffee" },
  "tomtom-nearby": { position: AMSTERDAM, poiCategories: ["CAFE_PUB"] },
  "tomtom-ev-search": { position: AMSTERDAM },
  "tomtom-area-search": { query: "cafe", center: AMSTERDAM, radius: 1000 },
  "tomtom-search-along-route": { origin: AMSTERDAM, destination: UTRECHT, query: "coffee" },
  "tomtom-poi-categories": {},
  "tomtom-routing": { locations: [AMSTERDAM, UTRECHT] },
  "tomtom-traffic": { bbox: [4.8, 52.3, 4.95, 52.4] },
};
