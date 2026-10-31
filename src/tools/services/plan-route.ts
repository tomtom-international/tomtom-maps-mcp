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
 * `tomtom-plan-route` and `tomtom-get-traffic`. `tomtom-plan-route` takes
 * `locations: locationInput[]`, and `tomtom-get-traffic` a `where`, whose mode
 * `alongRoute` takes `locations` too, so a place NAME needs no geocode call first.
 */

import {
  type BBox,
  bboxFromBBoxes,
  getProgressAtNearestRoutePoint,
  type Route,
  type Routes,
  type TrafficIncidentDetails,
  withInsertedWaypoints,
} from "@tomtom-org/maps-sdk/core";
import * as turf from "@turf/turf";
import type { TrafficAppData } from "../../apps/traffic/incidents/framing";
import type { PlanRouteParams } from "../../schemas/routing/planRouteSchema";
import {
  type AlongRouteWhere,
  DEFAULT_CORRIDOR_METERS,
  type GetTrafficParams,
} from "../../schemas/traffic/trafficSchema";
import { getRoute, type RouteOptions } from "../../services/routing/routingService";
import { reverseGeocode } from "../../services/search/searchService";
import { getTrafficIncidents } from "../../services/traffic/trafficService";
import { IncorrectError } from "../../types/types";
import { logger } from "../../utils/logger";
import { incidentFeatures, routeFeaturesFromGeoJSON } from "../shared/geometry-response";
import { dedupeBy, queryAreas, shortfallNotes } from "../shared/in-batches";
import {
  locationKey,
  locationLabel,
  type ResolvedLocation,
  resolveLocationInputs,
} from "../shared/inputs/location-input";
import {
  describeAreas,
  describeBias,
  type ResolvedArea,
  resolvedAreasOf,
  resolveNearby,
  resolveWithin,
} from "../shared/inputs/resolve-where";
import {
  buildErrorResponse,
  buildToolResponse,
  capTrafficIncidents,
  requestedTrafficFields,
  trimRoutingResponse,
  trimTrafficResponse,
} from "../shared/response-trimmer";
import {
  analyzeRoutes,
  type Checkpoint,
  compareWithUsualRoute,
  directionsOf,
  positionAtCheckpoint,
  withSectionProgress,
} from "../shared/route-analysis";
import type { ToolResponse } from "../shared/tool-entry";

// ---------------------------------------------------------------------------
// plan-route
// ---------------------------------------------------------------------------

type Waypoint = Pick<ResolvedLocation, "name" | "position"> & { inserted?: true };

/**
 * The waypoints with `insertStops` slotted where each costs the least, read off a
 * first route through `locations` alone.
 */
async function withStopsInserted(
  waypoints: Waypoint[],
  insertStops: PlanRouteParams["insertStops"],
  options: RouteOptions
): Promise<Waypoint[]> {
  if (!insertStops?.length) return waypoints;
  const stops: Waypoint[] = (await resolveLocationInputs(insertStops, "insertStops entry")).map(
    ({ name, position }) => ({ name, position, inserted: true })
  );
  const { maxAlternatives, curves, ...routeOptions } = options;
  const direct = await getRoute(
    waypoints.map((waypoint) => waypoint.position),
    routeOptions
  );
  // The positions come back as the arrays passed in, and a round trip passes one
  // twice: each waypoint is taken once.
  const unvisited = [...waypoints, ...stops];
  return withInsertedWaypoints(
    direct.features[0],
    waypoints.map((waypoint) => waypoint.position),
    stops.map((stop) => stop.position)
  ).map((position) => {
    const index = unvisited.findIndex((waypoint) => waypoint.position === position);
    return unvisited.splice(index, 1)[0];
  });
}

/**
 * Takes the places `insertStops` also names out of the middle of `locations`, so
 * each is visited once, where it costs least: naming a stop in `insertStops` asks
 * for that order.
 *
 * @throws IncorrectError when an `insertStops` entry is the origin or the destination.
 */
function withoutRepeatedStops(
  locations: PlanRouteParams["locations"],
  insertStops: PlanRouteParams["insertStops"]
): { locations: PlanRouteParams["locations"]; insertStops: PlanRouteParams["insertStops"] } {
  if (!insertStops?.length) return { locations, insertStops };
  const stops = dedupeBy(insertStops, locationKey).unique;
  const toInsert = new Set(stops.map(locationKey));
  const ends = [locations[0], locations[locations.length - 1]];
  const insertedEnds = ends.filter((end) => toInsert.has(locationKey(end)));
  if (insertedEnds.length) {
    throw new IncorrectError(
      "An `insertStops` entry is the trip's origin or destination. Keep it in `locations` only.",
      { entries: insertedEnds.map(locationLabel) }
    );
  }
  return {
    locations: [
      ends[0],
      ...locations.slice(1, -1).filter((stop) => !toInsert.has(locationKey(stop))),
      ends[1],
    ],
    insertStops: stops,
  };
}

/**
 * Each checkpoint's position on the route and the town there, or that the route ends
 * first. A failed town lookup leaves `near` out rather than losing the route.
 */
async function checkpointsAlong(route: Route, checkpoints: readonly Checkpoint[]) {
  return Promise.all(
    checkpoints.map(async (checkpoint) => {
      const at = positionAtCheckpoint(route, checkpoint);
      if (!at) return { ...checkpoint, beyondRouteEnd: true };
      const place = await reverseGeocode(at.position).catch((error) => {
        logger.warn({ error: String(error) }, "Reverse geocoding a checkpoint failed");
        return undefined;
      });
      const address = place?.properties?.address;
      const near = [address?.municipality, address?.countrySubdivisionName, address?.country]
        .filter(Boolean)
        .join(", ");
      return { ...checkpoint, ...at, ...(near && { near }) };
    })
  );
}

/**
 * Where a route result's turns are, and are not. Without it, a model asked for the
 * turns counted `curvature`'s bends, and guessed a northernmost point from the ends.
 */
const GUIDANCE_NOTE =
  "`guidance` counts each route's manoeuvres from its turn-by-turn instructions; `curvature` " +
  "counts bends in the road, not turns.";
const DIRECTIONS_NOTE = " Set `directions: true` for the steps themselves.";

/** The routes for the widget, which draws no guidance: a long trip's steps would crowd out its line. */
const withoutGuidance = (routes: Routes): Routes => ({
  ...routes,
  features: routes.features.map(
    ({ properties: { guidance: _guidance, ...properties }, ...route }) => ({
      ...route,
      properties,
    })
  ),
});
const LINE_NOTE =
  ' The route line is only in a `geometry` field, which response_detail "geometry" adds: ' +
  "without it, the result cannot say where the route runs between the places it names.";

export async function planRouteHandler(params: PlanRouteParams): Promise<ToolResponse> {
  const {
    locations: requestedLocations,
    insertStops: requestedStops,
    compareWithUsualRoute: compareUsual,
    checkpoints,
    directions,
    show_ui = false,
    response_detail = "compact",
    ...options
  } = params;

  try {
    const { locations, insertStops } = withoutRepeatedStops(requestedLocations, requestedStops);
    const resolved = await resolveLocationInputs(locations, "location");
    const waypoints = await withStopsInserted(
      resolved.map(({ name, position }) => ({ name, position })),
      insertStops,
      options
    );
    const positions = waypoints.map((waypoint) => waypoint.position);
    logger.info({ stops: positions.length }, "Plan route");

    const [result, usual] = await Promise.all([
      getRoute(positions, options, { guidance: true }),
      compareUsual
        ? getRoute(positions, { ...options, traffic: "historical", maxAlternatives: 0 })
        : undefined,
    ]);
    const [first] = result.features;
    const analyses = analyzeRoutes(result);

    return await buildToolResponse(
      result,
      (full) => trimRoutingResponse(withSectionProgress(full), analyses),
      {
        showUI: show_ui,
        responseDetail: response_detail,
        appData: withoutGuidance(result),
        geometry: routeFeaturesFromGeoJSON,
        context: {
          // Echo where each waypoint actually resolved: a route that went somewhere
          // unexpected is nearly always a mis-resolved name, and without this the
          // model cannot tell that from a bad route.
          waypoints,
          // A full result is the API's own routes, without the analyses the notes describe.
          ...(response_detail !== "full" && {
            note: GUIDANCE_NOTE + (directions ? "" : DIRECTIONS_NOTE) + LINE_NOTE,
          }),
          ...(directions && first && { directions: directionsOf(first) }),
          ...(usual && { usualRoute: compareWithUsualRoute(first, usual.features[0]) }),
          ...(checkpoints?.length && { checkpoints: await checkpointsAlong(first, checkpoints) }),
        },
      }
    );
  } catch (error: unknown) {
    return buildErrorResponse(error, "Route calculation");
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

/**
 * Merges the incident sets from several areas into one, dropping repeats: two
 * named cities can share a motorway, and counting its jam twice would make "how
 * many hold-ups" a number about geometry rather than traffic.
 */
const mergeIncidents = (
  responses: readonly TrafficIncidentDetails[]
): { response: TrafficIncidentDetails; duplicates: number } => {
  const { unique: features, duplicates } = dedupeBy(
    responses.flatMap((response) => response.features),
    // Without an id, the whole record: two distinct incidents can share a point.
    (incident) => String(incident.id ?? JSON.stringify(incident))
  );

  return { response: { ...responses[0], features }, duplicates };
};

/** How long a stretch of route one corridor piece starts from, before pieces merge up to the cap. */
const CORRIDOR_STRETCH_KM = 20;

/** A bbox grown by `meters` on every side. */
const padded = ([west, south, east, north]: BBox, meters: number): BBox => {
  const latDegrees = meters / 110_570;
  const lonDegrees = meters / (111_320 * Math.cos((((south + north) / 2) * Math.PI) / 180));
  return [west - lonDegrees, south - latDegrees, east + lonDegrees, north + latDegrees];
};

/**
 * The corridor `meters` either side of a route, as polygons whose bounds each
 * stay within the traffic API's cap: one for a city trip, several for a long one.
 * Neighbouring pieces overlap where they join, so their incidents are merged.
 */
const corridorAreas = (route: Route, meters: number): TrafficTargets["areas"] => {
  // About 55 m at most (a degree of latitude is 110,570 m), and a quarter of a narrow
  // corridor's width, so the simplified line never cuts a bend out of the corridor.
  const tolerance = Math.min(0.0005, meters / 4 / 110_570);
  const line = turf.simplify(turf.lineString(route.geometry.coordinates), { tolerance });
  const stretches = turf
    .lineChunk(line, CORRIDOR_STRETCH_KM, { units: "kilometers" })
    .features.map((stretch) => stretch.geometry.coordinates);

  const pieces: (typeof stretches)[number][] = [];
  for (const stretch of stretches) {
    const last = pieces.at(-1);
    const joined = last && [...last, ...stretch.slice(1)];
    if (
      joined &&
      bboxAreaKm2(padded(turf.bbox(turf.lineString(joined)) as BBox, meters)) <=
        MAX_TRAFFIC_AREA_KM2
    ) {
      pieces[pieces.length - 1] = joined;
    } else {
      pieces.push(stretch);
    }
  }
  return pieces.map((piece) => {
    const polygon = turf.buffer(turf.lineString(piece), meters, { units: "meters" })?.geometry;
    if (!polygon) throw new Error("Buffering a route stretch gave no polygon");
    return { bbox: turf.bbox(polygon) as BBox, polygon };
  });
};

/**
 * Plans the drive `where` names and returns the corridor along it.
 *
 * @throws IncorrectError when no driving route connects the locations.
 */
const resolveCorridor = async (where: AlongRouteWhere): Promise<TrafficTargets> => {
  const meters = where.withinMeters ?? DEFAULT_CORRIDOR_METERS;
  const stops = await resolveLocationInputs(where.locations, "location");
  const [route] = (await getRoute(stops.map((stop) => stop.position))).features;
  if (!route) {
    throw new IncorrectError(
      "No driving route connects the locations, so there is no corridor to report on. Check " +
        'each location is reachable by road, or ask about an area with mode "within".',
      { locations: stops.map(({ name }) => name) }
    );
  }
  const { lengthInMeters, travelTimeInSeconds, trafficDelayInSeconds } = route.properties.summary;
  return {
    areas: corridorAreas(route, meters),
    route,
    searched: {
      scope: `within ${meters} m of the drive ${stops.map(({ name }) => name).join(" → ")}`,
      route: { lengthInMeters, travelTimeInSeconds, trafficDelayInSeconds },
    },
  };
};

/** The areas to query traffic for, and how to describe them. */
interface TrafficTargets {
  areas: Pick<ResolvedArea, "bbox" | "polygon">[];
  searched: Record<string, unknown>;
  /** The drive whose corridor the areas are, for mode `alongRoute`. */
  route?: Route;
}

type TrimmedTraffic = ReturnType<typeof trimTrafficResponse>;

/**
 * The incidents in the order the drive meets them, each with how far along it
 * starts, so "which jam do I hit first?" reads off the top of the list. The
 * response itself is reordered, so the compact incidents and the geometry
 * features keep one numbering. An incident's start is the end of its line
 * nearest the route's start.
 */
function inDrivingOrder(
  route: Route,
  response: TrafficIncidentDetails
): { response: TrafficIncidentDetails; startsAfterMeters: (number | undefined)[] } {
  const along = ({ geometry }: TrafficIncidentDetails["features"][number]): number | undefined => {
    const ends =
      geometry.type === "Point"
        ? [geometry.coordinates]
        : [geometry.coordinates[0], geometry.coordinates.at(-1)];
    const offsets = ends.flatMap((end) =>
      end ? (getProgressAtNearestRoutePoint(route, end)?.distanceInMeters ?? []) : []
    );
    return offsets.length ? Math.round(Math.min(...offsets)) : undefined;
  };
  const located = response.features
    .map((feature) => ({ feature, startsAfterMeters: along(feature) }))
    .sort(
      (a, b) =>
        (a.startsAfterMeters ?? Number.POSITIVE_INFINITY) -
        (b.startsAfterMeters ?? Number.POSITIVE_INFINITY)
    );
  return {
    response: { ...response, features: located.map(({ feature }) => feature) },
    startsAfterMeters: located.map(({ startsAfterMeters }) => startsAfterMeters),
  };
}

/** The compact incidents, each with how far along the drive it starts where that is known. */
const withStartsAfter = (
  trimmed: TrimmedTraffic,
  startsAfterMeters: (number | undefined)[]
): TrimmedTraffic => ({
  ...trimmed,
  incidents: trimmed.incidents.map((incident, index) => {
    const offset = startsAfterMeters[index];
    return offset === undefined ? incident : { startsAfterMeters: offset, ...incident };
  }),
});

/**
 * Turns a `where` into the areas to query: a circle for `nearby`, each resolved
 * area for `within`, by its boundary where one is known, and the corridor for `alongRoute`.
 *
 * @throws IncorrectError when a `nearby` point or an `alongRoute` location does not resolve.
 */
const resolveTrafficTargets = async (where: GetTrafficParams["where"]): Promise<TrafficTargets> => {
  if (where.mode === "alongRoute") return resolveCorridor(where);
  if (where.mode === "nearby") {
    const bias = await resolveNearby(where);
    const polygon = turf.circle(bias.position, bias.radiusMeters, { units: "meters" }).geometry;
    return {
      areas: [{ bbox: turf.bbox(polygon) as BBox, polygon }],
      searched: { scope: describeBias(bias) },
    };
  }

  const areas = await resolveWithin(where);
  const resolvedAreas = resolvedAreasOf(areas);
  return {
    areas,
    searched: { scope: describeAreas(areas), ...(resolvedAreas.length && { resolvedAreas }) },
  };
};

/** The `searched` block: what was actually covered, and every way that falls short of it. */
const describeCoverage = (coverage: {
  mode: string;
  searched: Record<string, unknown>;
  queried: number;
  duplicates: number;
  oversized: number;
  failedAreas: number;
}): Record<string, unknown> => {
  const { mode, searched, queried, duplicates, oversized, failedAreas } = coverage;
  return {
    mode,
    ...searched,
    ...(queried > 1 && { areasQueried: queried }),
    ...(oversized > 0 && {
      oversizedAreas: oversized,
      oversizedNote:
        `${oversized} resolved area(s) exceeded the ${MAX_TRAFFIC_AREA_KM2.toLocaleString()} km² ` +
        "traffic cap and were not queried; these results cover the rest. Treat totals as a " +
        "lower bound.",
    }),
    ...shortfallNotes({
      records: "Incidents",
      verb: "queried",
      duplicates,
      failed: failedAreas,
    }),
  };
};

export async function getTrafficHandler(params: GetTrafficParams): Promise<ToolResponse> {
  const {
    where,
    show_ui = false,
    response_detail = "compact",
    categoryFilter,
    timeValidityFilter,
    maxResults,
    language,
  } = params;

  try {
    const { areas: targets, searched, route } = await resolveTrafficTargets(where);

    // Checked per area rather than over the union: several small areas are a
    // legitimate query however far apart they sit, and unioning them would invent
    // an oversized bbox covering everything in between.
    const withinCap = targets.filter(({ bbox }) => bboxAreaKm2(bbox) <= MAX_TRAFFIC_AREA_KM2);
    const oversized = targets.length - withinCap.length;

    if (!withinCap.length) {
      // A route's span is the classic way to blow the cap, and the route already
      // knows its own delays, so the way out is one fewer call, not a narrower one.
      throw new IncorrectError(
        "The area exceeds the traffic API's size limit. Name a smaller area in `where.queries` " +
          "(a city rather than a country), pass a tighter `boundingBox`, or a smaller " +
          '`radiusMeters` for mode nearby. For traffic along a route, use mode "alongRoute", ' +
          "which covers a corridor of any length.",
        {
          areaKm2: Math.round(Math.max(...targets.map(({ bbox }) => bboxAreaKm2(bbox)))),
          maxAreaKm2: MAX_TRAFFIC_AREA_KM2,
        }
      );
    }

    logger.info({ areas: withinCap.length, oversized }, "Get traffic");

    const { succeeded, failed } = await queryAreas(withinCap, ({ bbox, polygon }) =>
      getTrafficIncidents(polygon ?? bbox, { language, categoryFilter, timeValidityFilter })
    );

    // One area has nothing to merge, and merging it anyway would let the dedupe
    // touch a result no overlap can affect.
    const { response: result, duplicates } =
      succeeded.length === 1
        ? { response: succeeded[0], duplicates: 0 }
        : mergeIncidents(succeeded);

    // Agent-facing incidents are capped. The traffic app draws live incidents itself,
    // so it takes only the searched bounds to frame, which a named area has once resolved.
    const requested = requestedTrafficFields(timeValidityFilter);
    const capped = capTrafficIncidents(result, maxResults);
    const ordered = route && inDrivingOrder(route, capped);
    return await buildToolResponse(
      ordered ? ordered.response : capped,
      (response) => {
        const trimmed = trimTrafficResponse(response, requested);
        return ordered ? withStartsAfter(trimmed, ordered.startsAfterMeters) : trimmed;
      },
      {
        showUI: show_ui,
        responseDetail: response_detail,
        appData: {
          bbox: bboxFromBBoxes(withinCap.map(({ bbox }) => bbox)),
        } satisfies TrafficAppData,
        geometry: incidentFeatures,
        context: {
          searched: describeCoverage({
            mode: where.mode,
            searched,
            queried: withinCap.length,
            duplicates,
            oversized,
            failedAreas: failed,
          }),
        },
      }
    );
  } catch (error: unknown) {
    return buildErrorResponse(error, "Traffic lookup");
  }
}
