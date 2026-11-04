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
 * What each data tool's stored dataset looks like, for code that analyses it.
 *
 * `tomtom-analyse-datasets` runs code over datasets the model has only seen trimmed,
 * so without these it guesses property paths, and guesses wrong: categories are
 * code strings in `poi.categories[]`, not a `categorySet` of ids. Keyed by the
 * tool that produced a dataset, which `analyse-datasets` and `describe-dataset` both
 * report. Every path was read off a live response.
 */

/**
 * Dataset shapes, keyed by the tool that produced them. Kept terse: this text
 * ships on every `tools/list`, so it names the fields a question is likely to
 * need and the traps, not the whole schema.
 */
export const DATASET_SHAPES: Readonly<Record<string, string>> = {
  "tomtom-discover-places":
    "Result: { type, features[] }. Each feature: geometry { type:'Point', coordinates:[lng,lat] }; " +
    "properties { score, distance (metres, nearby only), detourTimeInSeconds and detourDistanceInMeters (maxDetour only), " +
    "alongRoute { meters, seconds, offRouteMeters } (alongRoute and maxDetour), " +
    "poi { name, categories[] (CODE STRINGS, e.g. 'ITALIAN_RESTAURANT'), localizedCategories[] " +
    "(e.g. 'italian restaurant'), phone, url, brands[], openingHours { timeRanges[] { start, end } " +
    "each { year, month, day, hour, minute } in local time }, timeZone { ianaId } }, " +
    "address { freeformAddress, municipality, neighbourhood, postalCode, streetName, " +
    "streetNumber, countryCode, countrySubdivision }, " +
    "chargingPark { connectors[] { type, currentType, ratedPowerKW, voltageV, currentA, " +
    "chargingSpeed, count } } }. " +
    "Traps: categories are code strings under poi.categories[], with no numeric ids; " +
    "openingHours is absent on many places.",

  "tomtom-locate-place":
    "Result: { type, features[] } — the candidates ranked best first, the located place being " +
    "features[0]. Each candidate: geometry (a Point); properties { type ('POI', 'Geography', " +
    "'Street', …), score, poi { name, categories[] }, address { freeformAddress, municipality, " +
    "neighbourhood, countrySubdivision, countryCode, country } }. With response_detail " +
    "'geometry', a last feature holds the located area's boundary: a Polygon or MultiPolygon " +
    "with properties { boundaryOf }.",

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

  "tomtom-data-viz":
    "Result: { type, features[] } — the caller's GeoJSON as drawn, normalised to a " +
    "FeatureCollection, properties as given.",

  "tomtom-get-traffic":
    "Result: { type, features[] } — every incident found, before the cap on what a result " +
    "shows. Each incident: geometry (LineString or Point); properties { id, category " +
    "('jam', 'roadworks', 'road-closed', 'danger', …), magnitudeOfDelay ('minor', 'moderate', " +
    "'major', 'indefinite', 'unknown'), delayInSeconds, lengthInMeters, from, to, roadNumbers[] " +
    "(e.g. ['A10']), startTime, endTime, timeValidity, probabilityOfOccurrence, numberOfReports, " +
    "events[] { code, description, category } }. " +
    "Trap: roadNumbers is empty on incidents that are not on a numbered road, and delayInSeconds " +
    "is absent where no delay is known, so guard both before grouping or summing.",

  "tomtom-derive-datasets":
    "Result: { type, features[] } — what its code returned, normalised to a FeatureCollection; " +
    "the paths are in the response that made it, and in tomtom-describe-dataset.",
};

/** The shapes, for `tomtom-analyse-datasets`'s description. */
export const DATASET_SHAPES_DOC = Object.entries(DATASET_SHAPES)
  .map(([tool, shape]) => `• ${tool} — ${shape}`)
  .join("\n");

/**
 * What each tool's dataset holds that its trimmed result leaves out. Models that
 * answered from the trimmed result alone measurably missed these: a field the
 * result doesn't show reads as a field the data doesn't have.
 */
const HELD_BEYOND_THE_RESULT: Readonly<Record<string, string>> = {
  "tomtom-discover-places":
    "every place's seven days of opening hours, each connector's type, power and count, and " +
    "every brand",
  "tomtom-locate-place": 'every candidate, and with response_detail "geometry" the boundary',
  "tomtom-plan-route":
    "each route's full line, every section (low-emission zones, tunnels, toll roads, lanes, " +
    "speed limits, countries), every instruction with its manoeuvre (toll gates, border " +
    "crossings, exits) and the drive time along the way",
  "tomtom-get-traffic":
    "every incident found, uncapped, with its startTime, endTime, probabilityOfOccurrence, " +
    "numberOfReports, lengthInMeters, events and geometry",
};

/** The note beside a result's `dataset_id`, pointing the model at what it holds. */
export const datasetNoteFor = (tool: string): string | undefined => {
  const held = HELD_BEYOND_THE_RESULT[tool];
  return (
    held &&
    `The dataset holds more than this result shows: ${held}. For a count, ranking, time ` +
      "window or geometry over it, run tomtom-analyse-datasets on dataset_id rather than reading " +
      "this result; to hand a subset of it to another tool, tomtom-derive-datasets."
  );
};
