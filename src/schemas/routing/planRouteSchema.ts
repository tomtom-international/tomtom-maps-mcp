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

import { z } from "zod";
import { locationInputSchema } from "../../tools/shared/inputs/location-input";
import { whereSchema } from "../../tools/shared/inputs/resolve-where";
import { uiVisibilityParam } from "../search/common";
import { analyseSchema } from "../shared/analyseSchema";
import { routingOptionsSchema } from "./common";

/**
 * EV planning as a nested object rather than a separate tool.
 *
 * `tomtom-ev-routing` existed because the charging-stop parameters had nowhere
 * else to live. They are a *mode* of planning a route, not a different task, and
 * splitting them into a second tool made the model choose between two
 * route-shaped tools on a distinction it could not see from the prompt alone.
 */
const evSchema = z
  .object({
    currentChargePercent: z
      .number()
      .min(0)
      .max(100)
      .describe("Battery charge at the start, as a percentage."),
    maxChargeKWH: z.number().positive().describe("Usable battery capacity in kWh."),
    minChargeAtDestinationPercent: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe("Charge to arrive with (default around 10%)."),
    minChargeAtChargingStopsPercent: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe("Charge to arrive at each charging stop with."),
    consumptionInKWH: z
      .array(z.object({ speedKMH: z.number(), consumptionUnitsPer100KM: z.number() }))
      .optional()
      .describe("Consumption curve — kWh per 100km at given speeds."),
    batteryCurve: z
      .array(z.object({ stateOfChargeInkWh: z.number(), maxPowerInkW: z.number() }))
      .optional()
      .describe("Charging curve — max accepted power at given states of charge."),
  })
  .describe(
    "Electric-vehicle planning. Provide this to have charging stops inserted automatically; omit " +
      "it for a normal route. `currentChargePercent` and `maxChargeKWH` are the minimum needed."
  );

export const tomtomPlanRouteSchema = {
  analyse: analyseSchema,

  locations: z
    .array(locationInputSchema)
    .min(2)
    .describe(
      "Ordered [origin, ...stops, destination] — at least two. Each entry is a place NAME " +
        "({ query, queryAs }), explicit coordinates ({ position }), or a place you already found " +
        "coordinates. Naming places directly is the point: no separate geocode step."
    ),
  ev: evSchema.optional(),
  ...routingOptionsSchema,
  ...uiVisibilityParam,
};

export type PlanRouteParams = z.input<z.ZodObject<typeof tomtomPlanRouteSchema>>;

const budgetSchema = z
  .object({
    type: z.enum(["time", "distance", "energy", "fuel"]).describe("What the budget measures."),
    value: z
      .number()
      .positive()
      .describe(
        "Budget amount: seconds for time, metres for distance, kWh for energy, litres for fuel."
      ),
  })
  .describe("One budget constraint.");

export const tomtomFindReachableAreasSchema = {
  analyse: analyseSchema,

  origins: z
    .array(locationInputSchema)
    .min(1)
    .describe(
      "One or more starting points — a place NAME or coordinates. One area is " +
        "computed per origin under the same budgets."
    ),
  budgets: z
    .array(budgetSchema)
    .min(1)
    .describe(
      "One or more budgets, applied to every origin. Pass several for nested rings " +
        "(e.g. 10, 20 and 30 minutes) in a SINGLE call — that used to be one call per budget."
    ),
  ...routingOptionsSchema,
  ...uiVisibilityParam,
};

export type FindReachableAreasParams = z.input<z.ZodObject<typeof tomtomFindReachableAreasSchema>>;

export const tomtomGetTrafficSchema = {
  analyse: analyseSchema,

  where: whereSchema.describe(
    "The area to report traffic for. Use mode `within` and name the area in `queries` " +
      '(e.g. ["Amsterdam"]) — no separate geocode step. `boundingBox` works if you have exact ' +
      "bounds, `route` reports incidents along a corridor around a stored route, and " +
      "Mode `nearby` covers a radius around a point."
  ),
  categoryFilter: z
    .array(z.string())
    .optional()
    .describe(
      "Restrict to incident categories, e.g. ['Accident', 'RoadClosed', 'Jam']. Omit for all."
    ),
  timeValidityFilter: z
    .enum(["present", "future", "all"])
    .optional()
    .describe("Which incidents to include by time validity. Default 'present'."),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe(
      "Maximum incidents shown (default 100). The FULL set is held server-side regardless — use " +
        "pass `analyse` to count or group over every incident rather than the visible rows."
    ),
  language: z.string().optional().describe("IETF language tag for descriptions, e.g. 'nl-NL'."),
  ...uiVisibilityParam,
};

export type GetTrafficParams = z.input<z.ZodObject<typeof tomtomGetTrafficSchema>>;
