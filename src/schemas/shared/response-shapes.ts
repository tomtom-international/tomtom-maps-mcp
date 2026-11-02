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
    "properties { score, distance (metres, nearby only), detourTimeInSeconds and detourDistanceInMeters (maxDetour only), " +
    "alongRoute { meters, seconds, offRouteMeters } (alongRoute and maxDetour), " +
    "poi { name, categories[] (CODE STRINGS, e.g. 'ITALIAN_RESTAURANT'), localizedCategories[] " +
    "(e.g. 'italian restaurant'), phone, url, brands[], openingHours { timeRanges[] { start, end } " +
    "each { year, month, day, hour, minute } in local time }, timeZone { ianaId } }, " +
    "address { freeformAddress, municipality, neighbourhood, postalCode, streetName, " +
    "streetNumber, countryCode, countrySubdivision }, " +
    "chargingPark { connectors[] { connector { type, currentType, ratedPowerKW, voltageV, " +
    "currentA, chargingSpeed }, count } } }. " +
    "Traps: categories are code strings under poi.categories[], with no numeric ids; connector " +
    "fields sit under the NESTED connectors[].connector, not connectors[] itself; openingHours is " +
    "absent on many places.",

  "tomtom-locate-place":
    "Result: { type, features[] } — the candidates ranked best first, the located place being " +
    "features[0]. Each feature: geometry (a Point); properties { type ('POI', 'Geography', " +
    "'Street', …), score, poi { name, categories[] }, address { freeformAddress, municipality, " +
    "neighbourhood, countrySubdivision, countryCode, country } }. The boundary polygon is not in " +
    "this result.",

  "tomtom-plan-route":
    "Result: { type, bbox, features[] } with ONE feature per route. geometry is a LineString whose " +
    "coordinates[] are [lng,lat] pairs — the full polyline. properties { index, " +
    "summary { lengthInMeters, travelTimeInSeconds, trafficDelayInSeconds, trafficLengthInMeters, " +
    "historicTrafficTravelTimeInSeconds, noTrafficTravelTimeInSeconds, departureTime, " +
    "arrivalTime }, sections { leg[], tunnel[], motorway[], urban[], lowEmissionZone[], " +
    "country[] { countryCodeISO3 }, speedLimit[] { maxSpeedLimitInKmh }, roadShields[] " +
    "{ roadShieldReferences[] { reference } }, importantRoadStretch[] { roadNumbers[] } }, " +
    "guidance { instructions[] { maneuver (e.g. 'TURN_LEFT', 'EXIT_MOTORWAY_RIGHT', " +
    "'ROUNDABOUT_STRAIGHT'), routeOffsetInMeters, message, roundaboutExitNumber } }, " +
    "progress[] { pointIndex, distanceInMeters, travelTimeInSeconds } }. " +
    "Every section entry carries startPointIndex/endPointIndex, which index into " +
    "geometry.coordinates.",

  "tomtom-get-traffic":
    "Result: { type, features[] } — every incident found, before the cap on what a response " +
    "shows. Each incident: geometry (LineString or Point); properties { id, category " +
    "('jam', 'roadworks', 'road-closed', 'danger', …), magnitudeOfDelay ('minor', 'moderate', " +
    "'major', 'indefinite', 'unknown'), delayInSeconds, lengthInMeters, from, to, roadNumbers[] " +
    "(e.g. ['A10']), startTime, endTime, timeValidity, probabilityOfOccurrence, numberOfReports, " +
    "events[] { code, description, category } }. " +
    "Trap: roadNumbers is empty on incidents that are not on a numbered road, and delayInSeconds " +
    "is absent where no delay is known, so guard both before grouping or summing.",
};

/** The `analyse` field description for one tool: bindings, then that tool's shape. */
export const analyseDescriptionFor = (toolName: string): string =>
  `${ANALYSE_BINDINGS} ${RESPONSE_SHAPES[toolName] ?? ""}`.trim();
