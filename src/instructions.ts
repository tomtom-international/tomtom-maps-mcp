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

const STANDARD_INSTRUCTIONS = `TomTom Maps MCP Server — geocoding, search, routing, traffic, and map visualization.

Tool selection:
- Directions/routes/travel time → tomtom-routing (A-to-B) or tomtom-waypoint-routing (3+ stops)
- Reachable area within time/distance budget → tomtom-reachable-range
- Traffic/accidents/congestion → tomtom-traffic (not tomtom-dynamic-map)
- Map with markers/routes/polygons → tomtom-dynamic-map
- Simple map image → tomtom-static-map
- Address to coordinates → tomtom-geocode (addresses only, not POIs)
- Coordinates to address → tomtom-reverse-geocode
- Vague or typo-tolerant query → tomtom-fuzzy-search
- POI by name or category → tomtom-poi-search
- Places near a point → tomtom-nearby

Guidelines:
- Geocode place names to coordinates before using routing or traffic tools.
- Use response_detail="compact" (default) to save tokens; use "full" only when detailed data is needed.`;

const ORBIS_INSTRUCTIONS = `TomTom Orbis Maps MCP Server — geocoding, search, routing, traffic, map visualization, and data visualization.

Tool selection:
- Directions/routes/travel time (A-to-B or multi-stop) → tomtom-routing
- EV long-distance routes with charging stops → tomtom-ev-routing
- Reachable area within time/distance budget → tomtom-reachable-range
- Traffic/accidents/congestion → tomtom-traffic (not tomtom-dynamic-map)
- Map with markers/routes/polygons → tomtom-dynamic-map
- Large datasets/heatmaps/clusters/choropleth → tomtom-data-viz (not tomtom-dynamic-map)
- Address to coordinates → tomtom-geocode (addresses only, not POIs)
- Coordinates to address → tomtom-reverse-geocode
- Vague or typo-tolerant query → tomtom-fuzzy-search
- POI by name or category → tomtom-poi-search (location bias, not strict boundary)
- Places near a point → tomtom-nearby (radius)
- POIs within a strict boundary → tomtom-area-search (polygon/bbox/circle)
- POIs along a driving route → tomtom-search-along-route
- EV charging stations → tomtom-ev-search
- POI category codes → tomtom-poi-categories (required before using poiCategories filters; never guess codes)

Guidelines:
- Geocode place names to coordinates before using routing or traffic tools.
- Use response_detail="compact" (default) to save tokens; use "full" only when detailed data is needed.`;

export function getServerInstructions(isOrbis: boolean): string {
  return isOrbis ? ORBIS_INSTRUCTIONS : STANDARD_INSTRUCTIONS;
}
