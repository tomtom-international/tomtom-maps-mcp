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
 * The inputs every scope along a drive shares: the trip, the corridor's width,
 * and `stretch`, the part of the drive to cover. `tools/shared/inputs/route-stretch.ts`
 * turns a `stretch` into the stretches of a planned route.
 */

import { z } from "zod";
import { locationInputSchema } from "./locationInput";
import { modeBranch } from "./where";

export const DEFAULT_CORRIDOR_METERS = 1000;
const MAX_CORRIDOR_METERS = 5000;

/** The route section types a `stretch` can keep or take out. */
export const STRETCH_SECTION_TYPES = [
  "motorway",
  "tollRoad",
  "urban",
  "lowEmissionZone",
  "tunnel",
  "ferry",
] as const;

export type StretchSectionType = (typeof STRETCH_SECTION_TYPES)[number];

const sectionTypesSchema = z.array(z.enum(STRETCH_SECTION_TYPES)).min(1).optional();

const countryCodesSchema = z
  .array(
    z
      .string()
      .regex(/^[A-Za-z]{2}$/, 'Country codes are ISO 3166-1 alpha-2, e.g. "BE" (not "BEL").')
  )
  .min(1)
  .optional();

const STRETCH_UNITS = ["meters", "seconds", "percent"] as const;

export const routeStretchSchema = z
  .strictObject({
    from: z.number().nonnegative().optional(),
    to: z.number().positive().optional(),
    unit: z.enum(STRETCH_UNITS).optional(),
    lastMeters: z.number().positive().optional(),
    includeCountries: countryCodesSchema,
    includeSections: sectionTypesSchema,
    excludeCountries: countryCodesSchema,
    excludeSections: sectionTypesSchema,
  })
  .superRefine(({ from, to, unit, lastMeters }, context) => {
    const issue = (message: string) => context.addIssue({ code: "custom", message });
    if (lastMeters !== undefined && (from !== undefined || to !== undefined)) {
      issue("Give `lastMeters` or `from`/`to`, not both.");
    }
    if (from !== undefined && to !== undefined && from >= to) {
      issue("`to` must be greater than `from`.");
    }
    if (unit === "percent" && Math.max(from ?? 0, to ?? 0) > 100) {
      issue("With unit percent, `from` and `to` are 0-100.");
    }
  });

export type RouteStretch = z.infer<typeof routeStretchSchema>;

export const STRETCH_DOC =
  "`stretch` — part of the drive only. A window: `from`/`to`, measured from the start in " +
  '`unit` ("meters", the default; "seconds" of driving; "percent" of the length), or ' +
  "`lastMeters`; an end left out is the route's own. `includeCountries` (ISO alpha-2) and " +
  "`includeSections` keep only those parts of it; `excludeCountries` and `excludeSections` " +
  'take parts out. The Belgian part: { includeCountries: ["BE"] }; the middle fifth: ' +
  '{ from: 40, to: 60, unit: "percent" }; motorways outside towns: { includeSections: ' +
  '["motorway"], excludeSections: ["urban"] }. It may leave several separate stretches, ' +
  "listed in `searched.stretch`.";

/** What a tool whose `where` description carries {@link STRETCH_DOC} says on each `stretch`. */
export const STRETCH_POINTER = "Part of the drive only; `where` says how.";

/** The trip a scope along a drive follows. */
export const tripLocationsSchema = z
  .array(locationInputSchema)
  .min(2)
  .describe(
    "The trip: ordered [origin, ...stops, destination], each a place name ({ query }) or " +
      '{ position }. Every stop the user names goes in — "via Antwerp" is a location. The ' +
      "driving route is planned for you: no tomtom-plan-route call first."
  );

/** The drive a route mode follows: planned between `locations`, or held by an earlier result. */
export const driveFields = {
  locations: tripLocationsSchema.optional(),
  dataset_id: z
    .string()
    .optional()
    .describe(
      "Instead of `locations`: the `dataset_id` of a route tomtom-plan-route planned, followed " +
        "as planned, or of a line tomtom-derive-datasets built, line first."
    ),
};

/** `alongRoute` — a corridor either side of a drive, or of the stretches of it `stretch` picks. */
export const alongRouteWhereSchema = modeBranch("alongRoute", {
  ...driveFields,
  withinMeters: z
    .number()
    .positive()
    .max(MAX_CORRIDOR_METERS)
    .optional()
    .describe(
      `How far either side of the route to look, in metres (default ${DEFAULT_CORRIDOR_METERS}, ` +
        `at most ${MAX_CORRIDOR_METERS}). Covers both directions and the roads alongside.`
    ),
  stretch: routeStretchSchema.optional().describe(STRETCH_POINTER),
});

export type AlongRouteWhere = z.infer<typeof alongRouteWhereSchema>;
