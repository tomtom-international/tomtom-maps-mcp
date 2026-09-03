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
 * `tomtom-plan-route`, `tomtom-find-reachable-areas`, `tomtom-get-traffic`.
 *
 * The second half of the phase-4 collapse. Each replaces a tool that took raw
 * coordinates or a hand-built bounding box, and each now takes the shared input
 * types instead — so the geocode hops disappear:
 *
 *   routing + ev-routing → plan-route      `locations: locationInput[]`, `ev?`
 *   reachable-range      → find-reachable-areas  `origins`, `budgets[]`
 *   traffic              → get-traffic      `where`
 *
 * EV routing stops being a separate tool because it was never a separate task:
 * it is a route with charging parameters, and making the model choose between two
 * route-shaped tools on a distinction the prompt often does not state was a
 * selection trap rather than a feature.
 */

import { type BBox, bboxFromBBoxes } from "@tomtom-org/maps-sdk/core";
import type { Position } from "geojson";
import type {
  FindReachableAreasParams,
  GetTrafficParams,
  PlanRouteParams,
} from "../../schemas/routing/planRouteSchema";
import {
  calculateEVRoute,
  getReachableRange,
  getRoute,
  type ReachableRangesResult,
} from "../../services/routing/routingService";
import type { ReachableRangeOptions } from "../../services/routing/types";
import { getTrafficIncidents } from "../../services/traffic/trafficService";
import type { TrafficIncidentsResult } from "../../services/traffic/types";
import { IncorrectError } from "../../types/types";
import { logger } from "../../utils/logger";
import {
  evRouteFeatures,
  incidentFeatures,
  rangeFeaturesFromGeoJSON,
  routeFeaturesFromGeoJSON,
} from "../shared/geometry-response";
import { dedupeBy, fulfilledValues, inBatches, MAX_AREAS_SEARCHED } from "../shared/in-batches";
import { resolveLocationInputs } from "../shared/inputs/location-input";
import {
  areaBBox,
  describeAreas,
  describeBias,
  resolveNearby,
  resolveWithin,
} from "../shared/inputs/resolve-where";
import {
  buildErrorResponse,
  buildToolResponse,
  capTrafficIncidents,
  requestedTrafficFields,
  trimEVRoutingResponse,
  trimReachableRangeResponse,
  trimRoutingResponse,
  trimTrafficResponse,
} from "../shared/response-trimmer";
import type { ToolResponse } from "../shared/tool-entry";

// ---------------------------------------------------------------------------
// plan-route
// ---------------------------------------------------------------------------

export async function planRouteHandler(params: PlanRouteParams): Promise<ToolResponse> {
  const { locations, ev, show_ui = true, response_detail = "compact", ...options } = params;
  const label = ev ? "EV route calculation" : "Route calculation";

  try {
    const resolved = await resolveLocationInputs(locations, "location");
    const positions = resolved.map((l) => l.position);
    logger.info({ stops: positions.length, ev: Boolean(ev) }, "Plan route");

    // EV is a branch, not a tool: same task, extra constraints.
    const result = ev
      ? await calculateEVRoute({
          origin: positions[0],
          destination: positions[positions.length - 1],
          ...(positions.length > 2 && { waypoints: positions.slice(1, -1) }),
          ...ev,
          ...evRouteOptions(options),
        })
      : await getRoute(positions, options);

    return await buildToolResponse(result, ev ? trimEVRoutingResponse : trimRoutingResponse, {
      showUI: show_ui,
      responseDetail: response_detail,
      geometry: ev ? evRouteFeatures : routeFeaturesFromGeoJSON,
      dataset: { kind: "routes", provenance: { tool: "tomtom-plan-route", params } },
      context: {
        // Echo where each waypoint actually resolved: a route that went somewhere
        // unexpected is nearly always a mis-resolved name, and without this the
        // model cannot tell that from a bad route.
        waypoints: resolved.map(({ name, position }) => ({ name, position })),
        ...(ev && { evPlanning: true }),
      },
    });
  } catch (error: unknown) {
    return buildErrorResponse(error, label);
  }
}

type RouteOptionParams = Omit<PlanRouteParams, "locations" | "ev" | "show_ui" | "response_detail">;

/**
 * The route options long-distance EV routing takes.
 *
 * @throws IncorrectError for a routeType EV routing does not support.
 */
const evRouteOptions = ({ routeType, traffic, avoid, departAt }: RouteOptionParams) => {
  if (routeType === "thrilling") {
    throw new IncorrectError(
      "EV routes support routeType fast, short or efficient; thrilling is not available.",
      { routeType }
    );
  }
  return { routeType, traffic, avoid, departAt };
};

// ---------------------------------------------------------------------------
// find-reachable-areas
// ---------------------------------------------------------------------------

/** The service option each budget type sets. */
const BUDGET_FIELDS = {
  time: "timeBudgetInSec",
  distance: "distanceBudgetInMeters",
  energy: "energyBudgetInkWh",
  fuel: "fuelBudgetInLiters",
} as const satisfies Record<
  FindReachableAreasParams["budgets"][number]["type"],
  keyof ReachableRangeOptions
>;

export async function findReachableAreasHandler(
  params: FindReachableAreasParams
): Promise<ToolResponse> {
  const { origins, budgets, show_ui = true, response_detail = "compact", ...options } = params;

  try {
    const resolved = await resolveLocationInputs(origins, "origin");
    logger.info({ origins: resolved.length, budgets: budgets.length }, "Find reachable areas");

    // One call per (origin, budget) pair, bundled into a single dataset. The old
    // tool took exactly one budget, so nested rings meant N tool calls and N
    // results the model had to correlate itself.
    const results: ReachableRangesResult[] = [];
    for (const origin of resolved) {
      for (const budget of budgets) {
        results.push(
          await getReachableRange(origin.position, {
            ...options,
            [BUDGET_FIELDS[budget.type]]: budget.value,
          })
        );
      }
    }

    // Every returned polygon in one FeatureCollection, so the result is a single
    // shape set rather than one collection per budget.
    const features = results.flatMap((result) => result.features);
    const collection: ReachableRangesResult = {
      type: "FeatureCollection",
      features,
      // The app opens on this ring; the largest shows every ring that was asked for.
      requestedBudgetValue: Math.max(...results.map((r) => r.requestedBudgetValue)),
    };

    return await buildToolResponse(collection, trimReachableRangeResponse, {
      showUI: show_ui,
      responseDetail: response_detail,
      geometry: rangeFeaturesFromGeoJSON,
      dataset: { kind: "ranges", provenance: { tool: "tomtom-find-reachable-areas", params } },
      context: {
        origins: resolved.map(({ name, position }) => ({ name, position })),
        budgets,
        areaCount: features.length,
      },
    });
  } catch (error: unknown) {
    return buildErrorResponse(error, "Reachable areas");
  }
}

// ---------------------------------------------------------------------------
// get-traffic
// ---------------------------------------------------------------------------

/**
 * The traffic API's hard ceiling on the area of a `bbox` parameter.
 *
 * Exceeding it returns a bare 400 that surfaces as "Bad request to TomTom API",
 * which tells an agent nothing and costs it a retry. Checking first lets the
 * failure explain itself and name the way out.
 */
const MAX_TRAFFIC_AREA_KM2 = 10_000;

/** Rough area of a bbox in km². Good enough to compare against a 10,000 km² cap. */
const bboxAreaKm2 = ([west, south, east, north]: BBox): number => {
  const midLat = ((south + north) / 2) * (Math.PI / 180);
  const widthKm = Math.abs(east - west) * 111.32 * Math.cos(midLat);
  const heightKm = Math.abs(north - south) * 110.57;
  return widthKm * heightKm;
};

/** A square bbox around a point, for `nearby` mode. */
const bboxAround = (position: Position, radiusMeters: number): BBox => {
  const latDelta = radiusMeters / 111_320;
  const lngDelta = radiusMeters / (111_320 * Math.cos((position[1] * Math.PI) / 180) || 1);
  return [
    position[0] - lngDelta,
    position[1] - latDelta,
    position[0] + lngDelta,
    position[1] + latDelta,
  ];
};

/**
 * Merges the incident sets from several areas into one, dropping repeats.
 *
 * Areas overlap — nested isochrone budgets are the common case, and two named
 * cities can share a motorway — so the same incident arrives more than once.
 * Counting it twice would turn "how many hold-ups" into a number about geometry
 * rather than traffic, which is the same failure as reporting one area's count
 * for all of them.
 */
const mergeIncidents = (
  responses: readonly TrafficIncidentsResult[]
): { response: TrafficIncidentsResult; duplicates: number } => {
  const { unique: incidents, duplicates } = dedupeBy(
    responses.flatMap((response) => response.incidents ?? []),
    // The API's incident id when there is one. Without an id, the whole
    // record — NOT the geometry, which would merge two distinct incidents
    // that happen to share a point, turning "how many hold-ups" into an
    // undercount as confidently as the old first-area-only answer overcounted
    // its coverage.
    (incident) => incident.properties?.id ?? JSON.stringify(incident)
  );

  return { response: { ...responses[0], incidents }, duplicates };
};

/** The bounding boxes to query traffic for, and how to describe them. */
interface TrafficTargets {
  bboxes: BBox[];
  scope: string;
  unsearchedAreas: number;
}

/**
 * Turns a `where` into the bounding boxes to query.
 *
 * `within` can resolve to many areas — several named places, or one isochrone
 * whose rings each come back separately — and the traffic API takes a single
 * bbox per call, so covering the requested scope means one call each. Querying
 * the first and noting the rest in the response was the previous behaviour: the
 * note went unread and one polygon's incidents were reported as the whole area's.
 *
 * @throws IncorrectError when `where` does not describe an area.
 */
const resolveTrafficTargets = async (where: GetTrafficParams["where"]): Promise<TrafficTargets> => {
  if (where.mode === "nearby") {
    const bias = await resolveNearby(where);
    if (!bias.position) {
      throw new IncorrectError(
        "Could not resolve a point to report traffic around. Give `position`, a resolvable " +
          '`query`, or use mode "within" with an area name.',
        {}
      );
    }
    return {
      bboxes: [bboxAround(bias.position, bias.radiusMeters)],
      scope: describeBias(bias),
      unsearchedAreas: 0,
    };
  }

  if (where.mode !== "within") {
    throw new IncorrectError(
      'Traffic needs an area. Use mode "within" with an area name in `queries` or a ' +
        'boundingBox — "global" traffic is not a meaningful query.'
    );
  }

  const usable = (await resolveWithin(where)).flatMap((area) => {
    const bbox = areaBBox(area);
    return bbox ? [{ area, bbox }] : [];
  });
  if (!usable.length) {
    throw new IncorrectError("The resolved area had no usable bounds to query traffic for.");
  }

  const searched = usable.slice(0, MAX_AREAS_SEARCHED);
  return {
    bboxes: searched.map(({ bbox }) => bbox),
    scope: describeAreas(searched.map(({ area }) => area)),
    unsearchedAreas: usable.length - searched.length,
  };
};

/**
 * The `searched` block: what was actually covered, and every way that falls
 * short of what was asked for.
 *
 * Each shortfall is named rather than left to be inferred from a count. A total
 * that silently covers part of the requested scope is the failure this whole
 * fan-out exists to remove, and it is indistinguishable from a correct one
 * unless the response says so.
 */
const describeCoverage = (coverage: {
  mode: string;
  scope: string;
  queried: readonly BBox[];
  duplicates: number;
  oversized: number;
  failedAreas: number;
  unsearchedAreas: number;
}): Record<string, unknown> => {
  const { mode, scope, queried, duplicates, oversized, failedAreas, unsearchedAreas } = coverage;
  return {
    mode,
    scope,
    // One area keeps the single `bbox` it always reported; several name
    // themselves, since "which bounds produced this count" is the first thing
    // anyone checks about a merged total.
    ...(queried.length === 1
      ? { bbox: queried[0] }
      : { areasQueried: queried.length, bboxes: queried }),
    ...(duplicates > 0 && {
      duplicatesMerged: duplicates,
      duplicatesNote:
        "Incidents found in more than one area were counted once. Overlapping or nested areas " +
        "(isochrone budgets, for instance) are the usual cause.",
    }),
    ...(oversized > 0 && {
      oversizedAreas: oversized,
      oversizedNote:
        `${oversized} resolved area(s) exceeded the ${MAX_TRAFFIC_AREA_KM2.toLocaleString()} km² ` +
        "traffic cap and were not queried; these results cover the rest. Treat totals as a " +
        "lower bound.",
    }),
    ...(failedAreas > 0 && {
      note:
        `${failedAreas} of the resolved areas could not be queried; these results cover the ` +
        "rest. Treat totals as a lower bound.",
    }),
    ...(unsearchedAreas > 0 && {
      unsearchedAreas,
      unsearchedNote:
        `${unsearchedAreas} further area(s) were resolved but not queried (limit of ` +
        `${MAX_AREAS_SEARCHED} per call) — narrow \`where\` or issue another call.`,
    }),
  };
};

export async function getTrafficHandler(params: GetTrafficParams): Promise<ToolResponse> {
  const {
    where,
    show_ui = true,
    response_detail = "compact",
    categoryFilter,
    timeValidityFilter,
    maxResults,
    language,
  } = params;

  try {
    const { bboxes: targets, scope, unsearchedAreas } = await resolveTrafficTargets(where);

    // Checked per area rather than over the union: several small areas are a
    // legitimate query however far apart they sit, and unioning them would invent
    // an oversized bbox covering everything in between.
    const withinCap = targets.filter((candidate) => bboxAreaKm2(candidate) <= MAX_TRAFFIC_AREA_KM2);
    const oversized = targets.length - withinCap.length;

    if (!withinCap.length) {
      // A route's span is the classic way to blow the cap, and the route already
      // knows its own delays, so the way out is one fewer call, not a narrower one.
      throw new IncorrectError(
        "The area exceeds the traffic API's size limit. Name a smaller area in `where.queries` " +
          "(a city rather than a country), or pass a tighter `boundingBox`. For traffic along a " +
          "route, read the route itself: tomtom-plan-route returns `summary.trafficDelayInSeconds` " +
          "and a `sections.traffic` entry for every hold-up.",
        {
          areaKm2: Math.round(Math.max(...targets.map(bboxAreaKm2))),
          maxAreaKm2: MAX_TRAFFIC_AREA_KM2,
        }
      );
    }

    logger.info({ scope, areas: withinCap.length, oversized }, "Get traffic");

    const settled = await inBatches(withinCap, (target) =>
      getTrafficIncidents(target, { language, categoryFilter, timeValidityFilter, maxResults })
    );

    const succeeded = fulfilledValues(settled);
    // Every area failing is a failed lookup, not an empty one.
    if (!succeeded.length) {
      throw (settled[0] as PromiseRejectedResult).reason;
    }

    // One area has nothing to merge, and merging it anyway would let the dedupe
    // touch a result no overlap can affect.
    const { response: result, duplicates } =
      succeeded.length === 1
        ? { response: succeeded[0], duplicates: 0 }
        : mergeIncidents(succeeded);

    // Agent-facing incidents are capped; the map app gets the uncapped result,
    // plus the searched bounds to frame, which a named area only has once resolved.
    const requested = requestedTrafficFields(timeValidityFilter);
    return await buildToolResponse(
      capTrafficIncidents(result, maxResults),
      (capped) => trimTrafficResponse(capped, requested),
      {
        showUI: show_ui,
        responseDetail: response_detail,
        cached: { ...result, bbox: bboxFromBBoxes(withinCap) },
        geometry: incidentFeatures,
        dataset: { kind: "incidents", provenance: { tool: "tomtom-get-traffic", params } },
        context: {
          searched: describeCoverage({
            mode: where.mode,
            scope,
            queried: withinCap,
            duplicates,
            oversized,
            failedAreas: settled.length - succeeded.length,
            unsearchedAreas,
          }),
        },
      }
    );
  } catch (error: unknown) {
    return buildErrorResponse(error, "Traffic lookup");
  }
}
