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
 * What each tool's UNTRIMMED result looks like, for code that queries it.
 *
 * Stateless code execution has a discoverability problem that is easy to miss:
 * `analyse` runs in the SAME call that produces the data, so the model writes its
 * filter having never seen a response. Without this, it guesses property paths —
 * and measurably guesses wrong. The first version of the `analyse` field carried
 * one example that pointed at `properties.poi.categorySet`, a field that does not
 * exist on this surface; the real one is `properties.poi.categories[]`.
 *
 * Every path below was read off a live response rather than from the SDK's types,
 * because the question is what the API actually returns today.
 *
 * The cost of holding these here is real and worth stating: a stateless surface
 * has to publish them on EVERY tool that accepts code, in every `tools/list`,
 * whether or not any code is ever run. A surface with dataset handles can put the
 * same facts on its one analysis tool, keyed by kind — which is what the agent
 * toolkit's `buildEntryKindSchemaDocs` does.
 */

/** Shared preamble: the bindings are the same whichever tool is being queried. */
export const ANALYSE_BINDINGS =
  "In scope: `features` (every result feature, untrimmed), `data` (the whole raw response), " +
  "`turf` (geometry) and `h3` (hex grid). The code is a FUNCTION BODY and must `return` a " +
  "JSON-serializable value.";

/**
 * Per-tool result shapes, keyed by MCP tool name.
 *
 * Kept terse on purpose — this text ships on every `tools/list`, so it names the
 * fields a question is likely to need and the traps, not the whole schema.
 */
export const RESPONSE_SHAPES: Readonly<Record<string, string>> = {
  "tomtom-discover-places":
    "Result: { type, features[] }. Each feature: geometry { type:'Point', coordinates:[lng,lat] }; " +
    "properties { score, poi { name, categories[] (STRINGS, e.g. 'restaurant'), localizedCategories[], " +
    "phone, url, brands[] }, address { freeformAddress, municipality, postalCode, streetName, " +
    "streetNumber, countryCode, countrySubdivision }, entryPoints[], openingHours, " +
    "chargingPark { connectors[] { connector { type, currentType, ratedPowerKW, voltageV, currentA, " +
    "chargingSpeed }, count }, availability { connectorAvailabilities[] { count }, " +
    "chargingPointAvailability { count } } } }. " +
    "Traps: categories are plain strings under poi.categories[] — there is no categorySet of ids; " +
    "connector fields sit under the NESTED connectors[].connector, not connectors[] itself; " +
    "openingHours is frequently an empty array.",

  "tomtom-locate-place":
    "Result: { type, features[], bbox }. Each feature: geometry (a Point, or Polygon/MultiPolygon " +
    "when includeGeometry was set); bbox; properties { type, score, matchConfidence { score }, " +
    "geographyType[], address { freeformAddress, municipality, countrySubdivision, " +
    "countrySubdivisionName, countryCode, country } }.",

  "tomtom-plan-route":
    "Result: { type, bbox, features[] } with ONE feature per route. geometry is a LineString whose " +
    "coordinates[] are [lng,lat] pairs — the full polyline. properties { index, " +
    "summary { lengthInMeters, travelTimeInSeconds, trafficDelayInSeconds, trafficLengthInMeters, " +
    "departureTime, arrivalTime }, sections { leg[], tunnel[], motorway[], urban[], pedestrian[], " +
    "country[] { countryCodeISO3 }, speedLimit[] { maxSpeedLimitInKmh }, lowEmissionZone[], " +
    "roadShields[] { roadShieldReferences[] { reference } }, " +
    "importantRoadStretch[] { streetName, roadNumbers[] } } }. " +
    "Every section entry carries startPointIndex/endPointIndex, which index into " +
    "geometry.coordinates. Trap: turn-by-turn guidance is NOT part of this result, so a turn count " +
    "cannot be derived from it.",

  "tomtom-find-reachable-areas":
    "Result: { type, features[] } — one Polygon feature per origin × budget. " +
    "geometry { type:'Polygon', coordinates:[[[lng,lat], …]] }; properties { origin[], " +
    "budget { type, value } }. Use turf.booleanPointInPolygon to test containment, and " +
    "properties.budget to tell the rings apart.",

  "tomtom-get-traffic":
    "Result: { incidents[] } — the top-level array is `incidents`, NOT `features` (the `features` " +
    "binding is populated from it, so either works in code). Each incident: geometry " +
    "(LineString or Point); properties { id, iconCategory, magnitudeOfDelay (0-4), delay (SECONDS), " +
    "length (METRES), from, to, roadNumbers[] (e.g. ['A10']), startTime, endTime, timeValidity, " +
    "probabilityOfOccurrence, numberOfReports, events[] { code, description, iconCategory } }. " +
    "Trap: roadNumbers is absent on incidents that are not on a numbered road, so guard it before " +
    "grouping.",
};

/** The `analyse` field description for one tool: bindings, then that tool's shape. */
export const analyseDescriptionFor = (toolName: string): string =>
  `${ANALYSE_BINDINGS} ${RESPONSE_SHAPES[toolName] ?? ""}`.trim();
