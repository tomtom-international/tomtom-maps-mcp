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
 * What a dataset of each KIND holds, for code that queries it.
 *
 * The same facts a stateless surface has to publish on every tool that accepts
 * code — but keyed by dataset kind and carried by the one tool that runs code,
 * which is the arrangement the agent toolkit's `buildEntryKindSchemaDocs` uses.
 * A model reads it when it decides to analyse something, not on every call to
 * every data tool, and the data tools' own descriptions stay lean.
 *
 * These are static docs. `tomtom-describe-dataset` still reports the ACTUAL
 * shape of a specific result, with real counts and the value vocabulary of
 * low-cardinality fields; this is the cheap approximation that removes the need
 * to ask in the common case.
 *
 * Every path below was read off a live response rather than from the SDK's
 * types, because the question is what the API actually returns today.
 */

/** Dataset kind → what its features look like. */
export const KIND_SHAPES: Readonly<Record<string, string>> = {
  places:
    "`places` (from tomtom-discover-places / tomtom-locate-place): { type, features[] }. Feature: " +
    "geometry { type:'Point', coordinates:[lng,lat] } — or Polygon/MultiPolygon for a boundary from " +
    "locate-place; properties { score, poi { name, categories[] (STRINGS), localizedCategories[], " +
    "phone, url, brands[] }, address { freeformAddress, municipality, postalCode, streetName, " +
    "countryCode, countrySubdivision }, entryPoints[], openingHours, " +
    "chargingPark { connectors[] { connector { type, currentType, ratedPowerKW, voltageV, " +
    "chargingSpeed }, count }, availability { connectorAvailabilities[] { count } } } }. " +
    "Traps: poi.categories[] holds plain strings, not a categorySet of ids; connector fields sit " +
    "under the NESTED connectors[].connector; openingHours is often empty.",

  routes:
    "`routes` (from tomtom-plan-route): { type, bbox, features[] }, ONE feature per route. geometry " +
    "is a LineString whose coordinates[] are the full [lng,lat] polyline. properties { index, " +
    "summary { lengthInMeters, travelTimeInSeconds, trafficDelayInSeconds, trafficLengthInMeters, " +
    "departureTime, arrivalTime }, sections { leg[], tunnel[], motorway[], urban[], country[], " +
    "speedLimit[] { maxSpeedLimitInKmh }, lowEmissionZone[], roadShields[], " +
    "importantRoadStretch[] { streetName, roadNumbers[] } } }. Section entries carry " +
    "startPointIndex/endPointIndex into geometry.coordinates. Trap: turn-by-turn guidance is not " +
    "part of this result.",

  incidents:
    "`incidents` (from tomtom-get-traffic): { incidents[] } — the array is `incidents`, not " +
    "`features`. Each: geometry (LineString or Point); properties { id, iconCategory, " +
    "magnitudeOfDelay (0-4), delay (SECONDS), length (METRES), from, to, roadNumbers[] (e.g. " +
    "['A10']), startTime, endTime, probabilityOfOccurrence, numberOfReports, " +
    "events[] { code, description, iconCategory } }. Trap: roadNumbers is absent on incidents that " +
    "are not on a numbered road.",

  ranges:
    "`ranges` (from tomtom-find-reachable-areas): { type, features[] } — one Polygon per origin × " +
    "budget. geometry { type:'Polygon', coordinates:[[[lng,lat], …]] }; properties { origin[], " +
    "budget { type, value } }. Use turf.booleanPointInPolygon for containment and properties.budget " +
    "to tell rings apart.",

  byod: "`byod` (from tomtom-data-viz): { geojson, layers, title } — unwrap `.geojson` for features.",
};

/** The whole kind vocabulary, for the analysis tool's `code` description. */
export const KIND_SHAPE_DOCS = Object.values(KIND_SHAPES).join(" ");
