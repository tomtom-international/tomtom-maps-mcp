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
 * `tomtom-plan-route`, which takes `locations: locationInput[]`, so a place NAME
 * needs no geocode call first.
 */

import { type Route, type Routes, withInsertedWaypoints } from "@tomtom-org/maps-sdk/core";
import type { PlanRouteParams } from "../../schemas/routing/planRouteSchema";
import { getRoute, type RouteOptions } from "../../services/routing/routingService";
import { reverseGeocode } from "../../services/search/searchService";
import { IncorrectError } from "../../types/types";
import { optionalPartFailure } from "../../utils/apiErrorHandler";
import { logger } from "../../utils/logger";
import { routeFeaturesFromGeoJSON } from "../shared/geometry-response";
import { dedupeBy } from "../shared/in-batches";
import {
  locationKey,
  locationLabel,
  type ResolvedLocation,
  resolveLocationInputs,
} from "../shared/inputs/location-input";
import {
  buildErrorResponse,
  buildToolResponse,
  trimRoutingResponse,
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
  // One stop between an origin and a destination has only one place to go.
  if (waypoints.length === 2 && stops.length === 1) return [waypoints[0], stops[0], waypoints[1]];
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
 * first. A failed town lookup says so in `nearUnavailable` rather than losing the route.
 */
async function checkpointsAlong(route: Route, checkpoints: readonly Checkpoint[]) {
  return Promise.all(
    checkpoints.map(async (checkpoint) => {
      const at = positionAtCheckpoint(route, checkpoint);
      if (!at) return { ...checkpoint, beyondRouteEnd: true };
      let place: Awaited<ReturnType<typeof reverseGeocode>> | undefined;
      try {
        place = await reverseGeocode(at.position);
      } catch (error) {
        return {
          ...checkpoint,
          ...at,
          nearUnavailable: optionalPartFailure(error, "Checkpoint town"),
        };
      }
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

    // The comparison is an optional part: its failure is reported, not the route's.
    const [result, usual] = await Promise.all([
      getRoute(positions, options, { guidance: true }),
      compareUsual
        ? getRoute(positions, { ...options, traffic: "historical", maxAlternatives: 0 }).catch(
            (error: unknown) => ({
              unavailable: optionalPartFailure(error, "Usual-route comparison"),
            })
          )
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
          ...(usual && {
            usualRoute:
              "unavailable" in usual
                ? {
                    unavailable: `${usual.unavailable}. The route above is unaffected; ask again to compare.`,
                  }
                : compareWithUsualRoute(first, usual.features[0]),
          }),
          ...(checkpoints?.length && { checkpoints: await checkpointsAlong(first, checkpoints) }),
        },
      }
    );
  } catch (error: unknown) {
    return buildErrorResponse(error, "Route calculation");
  }
}
