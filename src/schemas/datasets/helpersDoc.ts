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
 * What the model is told about the sandbox helpers (`tools/shared/sandbox/helpers.ts`),
 * kept with the schema that describes them.
 */

/** The helper documentation, for `tomtom-analyse-datasets`'s description. */
export const HELPERS_DOC = [
  "HELPERS (in scope; a variable of your own named `place`, `route` or `incident` hides one; prefer",
  "them to reading these fields by hand):",
  '• `place.openAt(f, "YYYY-MM-DDTHH:MM")` → true/false at that LOCAL time, undefined when hours are unknown;',
  '  `place.opensOn(f, "YYYY-MM-DD")` → first opening "HH:MM" that day (a night carried over is not an opening);',
  "  `place.alwaysOpen(f)`; `place.connectors(f)` → [{ type, ratedPowerKW, currentType, count }];",
  "  `place.maxPowerKW(f)`; `place.brand(f)`; `place.categories(f)` → codes; `place.name(f)`.",
  "• `route.locate(r, point)` → { meters, seconds, offRouteMeters }: how far along a route feature, and",
  "  after how long, its nearest point to `point` ([lng, lat] or a feature) lies, measured as a place's",
  "  `alongRoute` is;",
  '  `route.sections(r, kind)` → each section of `kind` ("lowEmissionZone", "tunnel", "motorway", "country",',
  "  …) with startMeters, endMeters, lengthMeters, startSeconds, endSeconds;",
  "  `route.pointAt(r, meters)` → [lng, lat]; `route.instructions(r)` → the guidance instructions.",
  "• `incident.events(f)` → event description strings; `incident.distanceTo(f, [lng, lat])` → metres.",
].join("\n");
