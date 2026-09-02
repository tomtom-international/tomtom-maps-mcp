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

import type { BBox } from "@tomtom-org/maps-sdk/core";
import * as turf from "@turf/turf";
import type { Position } from "geojson";
import type {
  FindReachableAreasParams,
  GetTrafficParams,
  PlanRouteParams,
} from "../../schemas/routing/planRouteSchema";
import { datasetMeta, storeDataset } from "../../services/datasets/dataset-store";
import {
  calculateEVRoute,
  getReachableRange,
  getRoute,
} from "../../services/routing/routingService";
import { getTrafficIncidents } from "../../services/traffic/trafficService";
import { handleApiError } from "../../utils/apiErrorHandler";
import { logger } from "../../utils/logger";
import { runToolQuery } from "../shared/analyse-result";
import { inBatches, MAX_AREAS_SEARCHED } from "../shared/in-batches";
import { resolveLocationInputs } from "../shared/inputs/location-input";
import type { ResolvedArea } from "../shared/inputs/resolve-where";
import { describeAreas, resolveNearby, resolveWithin } from "../shared/inputs/resolve-where";
import {
  capTrafficIncidents,
  trimEVRoutingResponse,
  trimReachableRangeResponse,
  trimRoutingResponse,
  trimTrafficResponse,
} from "../shared/response-trimmer";
import type { ToolResponse } from "../shared/tool-entry";

const fail = (message: string): ToolResponse => ({
  content: [{ type: "text", text: JSON.stringify({ error: message }) }],
  isError: true,
});

const ok = (body: unknown, pretty = true): ToolResponse => ({
  content: [{ type: "text", text: JSON.stringify(body, null, pretty ? 2 : undefined) }],
});

// ---------------------------------------------------------------------------
// plan-route
// ---------------------------------------------------------------------------

export async function planRouteHandler(params: PlanRouteParams): Promise<ToolResponse> {
  const { locations, ev, analyse, show_ui = true, ...options } = params;

  const resolved = await resolveLocationInputs(locations, "location");
  if ("error" in resolved) return fail(resolved.error);
  const positions = resolved.value.map((l) => l.position);

  logger.info({ stops: positions.length, ev: Boolean(ev) }, "Plan route");

  try {
    // EV is a branch, not a tool: same task, extra constraints.
    const isEv = Boolean(ev);
    const result = isEv
      ? await calculateEVRoute({
          origin: positions[0],
          destination: positions[positions.length - 1],
          ...(positions.length > 2 && { waypoints: positions.slice(1, -1) }),
          ...ev,
          ...(options as Record<string, unknown>),
        } as Parameters<typeof calculateEVRoute>[0])
      : await getRoute(positions, options as Parameters<typeof getRoute>[1]);

    // An `analyse` asks a question OF this result instead of reading it, so it
    // short-circuits the projection entirely — see shared/query-result.ts.
    if (analyse) return runToolQuery(analyse, result, "Route planning");

    const dataset = storeDataset({
      data: result,
      kind: "routes",
      provenance: { tool: "tomtom-plan-route", params },
    });

    const projected = (
      isEv
        ? trimEVRoutingResponse(result as { features?: Array<Record<string, unknown>> })
        : trimRoutingResponse(result)
    ) as Record<string, unknown>;

    return ok({
      ...projected,
      // Echo where each waypoint actually resolved: a route that went somewhere
      // unexpected is nearly always a mis-resolved name, and without this the
      // model cannot tell that from a bad route.
      waypoints: resolved.value.map((l) => ({ name: l.name, position: l.position })),
      ...(isEv && { evPlanning: true }),
      _meta: datasetMeta(dataset, show_ui),
    });
  } catch (caught) {
    const formatted = handleApiError(caught, isEvLabel(ev));
    logger.error({ error: formatted.message }, "Plan route failed");
    return fail(formatted.message);
  }
}

const isEvLabel = (ev: unknown): string => (ev ? "EV route calculation" : "Route calculation");

// ---------------------------------------------------------------------------
// find-reachable-areas
// ---------------------------------------------------------------------------

/** Maps a budget entry onto the service's per-type option field. */
const budgetField = (type: string): string =>
  ({
    time: "timeBudgetInSec",
    distance: "distanceBudgetInMeters",
    energy: "energyBudgetInkWh",
    fuel: "fuelBudgetInLiters",
  })[type] as string;

export async function findReachableAreasHandler(
  params: FindReachableAreasParams
): Promise<ToolResponse> {
  const { origins, budgets, analyse, show_ui = true, ...options } = params;

  const resolved = await resolveLocationInputs(origins, "origin");
  if ("error" in resolved) return fail(resolved.error);

  logger.info({ origins: resolved.value.length, budgets: budgets.length }, "Find reachable areas");

  try {
    // One call per (origin, budget) pair, bundled into a single dataset. The old
    // tool took exactly one budget, so nested rings meant N tool calls and N
    // results the model had to correlate itself.
    const results: unknown[] = [];
    for (const origin of resolved.value) {
      for (const budget of budgets) {
        const result = await getReachableRange(origin.position, {
          ...(options as Record<string, unknown>),
          [budgetField(budget.type)]: budget.value,
        } as Parameters<typeof getReachableRange>[1]);
        results.push(result);
      }
    }

    // Flatten every returned polygon into one FeatureCollection so the result is
    // a single shape set rather than one collection per budget.
    const features = results.flatMap((result) => {
      const fc = result as { features?: unknown[]; type?: string };
      if (Array.isArray(fc.features)) return fc.features;
      return fc.type === "Feature" ? [result] : [];
    });
    const collection = { type: "FeatureCollection" as const, features };

    // An `analyse` asks a question OF this result instead of reading it, so it
    // short-circuits the projection entirely — see shared/query-result.ts.
    if (analyse) return runToolQuery(analyse, collection, "Reachable areas");

    const dataset = storeDataset({
      data: collection,
      kind: "ranges",
      provenance: { tool: "tomtom-find-reachable-areas", params },
    });

    return ok({
      ...(trimReachableRangeResponse(collection) as Record<string, unknown>),
      origins: resolved.value.map((o) => ({ name: o.name, position: o.position })),
      budgets,
      areaCount: features.length,
      _meta: datasetMeta(dataset, show_ui),
    });
  } catch (caught) {
    const formatted = handleApiError(caught, "Reachable areas");
    logger.error({ error: formatted.message }, "Find reachable areas failed");
    return fail(formatted.message);
  }
}

// ---------------------------------------------------------------------------
// get-traffic
// ---------------------------------------------------------------------------

/** The traffic API takes a bbox, so any resolved area is reduced to its bounds. */
const toBBox = async (area: {
  bbox?: BBox;
  polygon?: { type: string; coordinates: unknown };
}): Promise<BBox | undefined> => {
  if (area.bbox) return area.bbox;
  if (!area.polygon) return undefined;
  return turf.bbox({
    type: "Feature",
    geometry: area.polygon as never,
    properties: {},
  }) as BBox;
};

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

/** The only part of a traffic response the merge needs to see. */
interface TrafficIncidents {
  incidents?: unknown[];
}

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
  responses: readonly unknown[]
): { response: unknown; duplicates: number } => {
  const base = (responses[0] ?? {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const incidents: unknown[] = [];
  let duplicates = 0;

  for (const response of responses) {
    const batch = ((response as TrafficIncidents).incidents ?? []) as unknown[];
    for (const incident of batch) {
      const candidate = incident as {
        id?: string;
        geometry?: unknown;
        properties?: Record<string, unknown>;
      };
      // The API's incident id when there is one. Without an id, the whole
      // record — NOT the geometry, which would merge two distinct incidents
      // that happen to share a point, turning "how many hold-ups" into an
      // undercount as confidently as the old first-area-only answer overcounted
      // its coverage.
      const key =
        candidate.id ??
        (candidate.properties?.id as string | undefined) ??
        JSON.stringify(incident);
      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }
      seen.add(key);
      incidents.push(incident);
    }
  }

  return { response: { ...base, incidents }, duplicates };
};

/** Areas to query traffic for, or the reason there are none. */
type TrafficTargets =
  | { error: string }
  | { bboxes: BBox[]; scope: string; unsearchedAreas: number };

/**
 * Turns a `where` into the bounding boxes to query.
 *
 * `within` can resolve to many areas — several named places, or one isochrone
 * whose rings each come back separately — and the traffic API takes a single
 * bbox per call, so covering the requested scope means one call each. Querying
 * the first and noting the rest in the response was the previous behaviour: the
 * note went unread and one polygon's incidents were reported as the whole area's.
 */
const resolveTrafficTargets = async (where: GetTrafficParams["where"]): Promise<TrafficTargets> => {
  if (where.mode === "nearby") {
    const bias = await resolveNearby(where);
    if (!bias.position) {
      return {
        error:
          "Could not resolve a point to report traffic around. Give `position`, a resolvable " +
          '`query`, or use mode "within" with an area name.',
      };
    }
    return {
      bboxes: [bboxAround(bias.position, bias.radiusMeters ?? 1000)],
      scope: `within ${bias.radiusMeters}m of ${bias.label ?? bias.position.join(", ")}`,
      unsearchedAreas: 0,
    };
  }

  if (where.mode !== "within") {
    return {
      error:
        'Traffic needs an area. Use mode "within" with an area name in `queries`, a boundingBox, ' +
        'or a route corridor — "global" traffic is not a meaningful query.',
    };
  }

  const areas = await resolveWithin(where);
  if ("error" in areas) return { error: areas.error };

  const usable: { area: ResolvedArea; bbox: BBox }[] = [];
  for (const area of areas.value) {
    const bbox = await toBBox(area);
    if (bbox) usable.push({ area, bbox });
  }
  if (!usable.length) {
    return { error: "The resolved area had no usable bounds to query traffic for." };
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
    analyse,
    show_ui = true,
    categoryFilter,
    timeValidityFilter,
    maxResults,
    language,
  } = params;

  const resolved = await resolveTrafficTargets(where);
  if ("error" in resolved) return fail(resolved.error);
  const { bboxes: targets, scope, unsearchedAreas } = resolved;

  // A route's span is the classic way to blow the area cap — Amsterdam to Berlin
  // is roughly 130,000 km² of envelope — and it is also the case with the best
  // answer: the route already knows its own delays, so the fix is one fewer call
  // rather than a narrower one.
  //
  // Checked per area rather than over the union: several small areas are a
  // legitimate query however far apart they sit, and unioning them would invent
  // an oversized bbox covering everything in between.
  const withinCap = targets.filter((candidate) => bboxAreaKm2(candidate) <= MAX_TRAFFIC_AREA_KM2);
  const oversized = targets.length - withinCap.length;

  if (!withinCap.length) {
    const largest = Math.max(...targets.map(bboxAreaKm2));
    const fromRoute = where.mode === "within" && scope.includes("route corridor");
    return fail(
      `That area is about ${Math.round(largest).toLocaleString()} km²; the traffic API allows ` +
        `${MAX_TRAFFIC_AREA_KM2.toLocaleString()} km². ` +
        (fromRoute
          ? "For traffic along a route, read the route itself: tomtom-plan-route returns " +
            "`summary.trafficDelayInSeconds` and a `sections.traffic` entry for every hold-up, " +
            "with no second call needed."
          : "Name a smaller area in `where.queries` (a city rather than a country), or pass a " +
            "tighter `boundingBox`.")
    );
  }

  logger.info({ scope, areas: withinCap.length, oversized }, "Get traffic");

  try {
    const settled = await inBatches(withinCap, (target) =>
      getTrafficIncidents(target, {
        ...(language && { language }),
        ...(categoryFilter && { categoryFilter }),
        ...(timeValidityFilter && { timeValidityFilter }),
        ...(maxResults !== undefined && { maxResults }),
      } as Parameters<typeof getTrafficIncidents>[1])
    );

    const succeeded = settled
      .filter((outcome) => outcome.status === "fulfilled")
      .map((outcome) => outcome.value);
    // Every area failing is a failed lookup, not an empty one.
    if (!succeeded.length) {
      throw (settled[0] as PromiseRejectedResult).reason;
    }
    const failedAreas = settled.length - succeeded.length;

    // One area has nothing to merge, and merging it anyway would let the dedupe
    // touch a result no overlap can affect.
    const { response: merged, duplicates } =
      succeeded.length === 1
        ? { response: succeeded[0], duplicates: 0 }
        : mergeIncidents(succeeded);
    const result = merged as { incidents?: unknown[] };

    // An `analyse` asks a question OF this result instead of reading it, so it
    // short-circuits the projection entirely — see shared/query-result.ts.
    if (analyse) return runToolQuery(analyse, result, "Traffic");

    const dataset = storeDataset({
      data: result,
      kind: "incidents",
      provenance: { tool: "tomtom-get-traffic", params },
    });

    const total = result?.incidents?.length ?? 0;
    const capped = capTrafficIncidents(result, maxResults);
    const projected = trimTrafficResponse(capped) as Record<string, unknown>;
    const shown = (projected.incidents as unknown[] | undefined)?.length ?? 0;

    return ok(
      {
        ...projected,
        searched: describeCoverage({
          mode: where.mode,
          scope,
          queried: withinCap,
          duplicates,
          oversized,
          failedAreas,
          unsearchedAreas,
        }),
        ...(shown < total && {
          // Says which questions the visible rows CAN answer, not just which
          // they cannot. The cap keeps the most severe incidents rather than an
          // arbitrary slice, so "the single worst" is the first row — but a note
          // reading only "it is a sample" had the agent decline to name one at
          // all, which is a wrong answer arrived at by sound reasoning about a
          // misleading note.
          truncationNote:
            `Showing the ${shown} most severe of ${total} incidents, ranked by delay magnitude. ` +
            "The worst ones ARE above, so ranking questions — the single worst, the top few — are " +
            "answerable from this list. Totals, counts and per-road breakdowns are NOT — re-run " +
            "this call with `analyse` and the code sees every incident, not just these rows.",
        }),
        _meta: datasetMeta(dataset, show_ui),
      },
      // Compact JSON: dense bboxes return a lot of rows.
      false
    );
  } catch (caught) {
    const formatted = handleApiError(caught, "Traffic lookup");
    logger.error({ error: formatted.message }, "Get traffic failed");
    return fail(formatted.message);
  }
}
