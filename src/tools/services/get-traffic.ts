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
 * `tomtom-get-traffic`: the incidents in a `where`, whose mode `alongRoute` takes
 * `locations`, so a place NAME needs no geocode call first.
 */

import {
  type BBox,
  bboxFromBBoxes,
  getProgressAtNearestRoutePoint,
  type TrafficIncidentDetails,
} from "@tomtom-org/maps-sdk/core";
import * as turf from "@turf/turf";
import type { Position } from "geojson";
import type { TrafficAppData } from "../../apps/traffic/incidents/framing";
import { type AlongRouteWhere, DEFAULT_CORRIDOR_METERS } from "../../schemas/shared/alongRoute";
import type { GetTrafficParams } from "../../schemas/traffic/trafficSchema";
import {
  METERS_PER_DEGREE_LATITUDE,
  METERS_PER_DEGREE_LONGITUDE,
} from "../../services/map/geometryUtils";
import { getTrafficIncidents } from "../../services/traffic/trafficService";
import { IncorrectError } from "../../types/types";
import { logger } from "../../utils/logger";
import { incidentFeatures } from "../shared/geometry-response";
import { dedupeBy, queryAreas } from "../shared/in-batches";
import { resolveDrive } from "../shared/inputs/location-input";
import {
  type AreaBounds,
  areaPolygon,
  asOnePolygon,
  circleOf,
  describeAreas,
  describeBias,
  resolvedAreasOf,
  resolveNearby,
  resolveWithin,
} from "../shared/inputs/resolve-where";
import { describeStretches, resolveStretches, type Stretch } from "../shared/inputs/route-stretch";
import {
  buildErrorResponse,
  buildToolResponse,
  capTrafficIncidents,
  trimTrafficResponse,
} from "../shared/response-trimmer";
import type { ToolResponse } from "../shared/tool-entry";

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
  const widthKm = (Math.abs(east - west) * METERS_PER_DEGREE_LONGITUDE * Math.cos(midLat)) / 1000;
  const heightKm = (Math.abs(north - south) * METERS_PER_DEGREE_LATITUDE) / 1000;
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

/**
 * The areas packed into as few requests as the cap allows: areas whose bounds
 * together stay within it share one request, as one MultiPolygon, so Rotterdam
 * and Utrecht cost one request where Amsterdam and Brussels cost two.
 */
const requestGroups = (areas: readonly AreaBounds[]): AreaBounds[] => {
  const union = (a: BBox, b: BBox) => bboxFromBBoxes([a, b]) as BBox;
  const groups: { bbox: BBox; areas: AreaBounds[] }[] = [];
  for (const area of areas) {
    const group = groups.find(
      ({ bbox }) => bboxAreaKm2(union(bbox, area.bbox)) <= MAX_TRAFFIC_AREA_KM2
    );
    if (group) {
      group.bbox = union(group.bbox, area.bbox);
      group.areas.push(area);
    } else groups.push({ bbox: area.bbox, areas: [area] });
  }
  return groups.map(({ bbox, areas: grouped }) =>
    grouped.length === 1 ? grouped[0] : { bbox, polygon: asOnePolygon(grouped.map(areaPolygon)) }
  );
};

/** How long a chunk of the line one corridor piece starts from, before pieces merge up to the cap. */
const CORRIDOR_CHUNK_KM = 20;

/** A bbox grown by `meters` on every side. */
const padded = ([west, south, east, north]: BBox, meters: number): BBox => {
  const latDegrees = meters / METERS_PER_DEGREE_LATITUDE;
  const lonDegrees =
    meters / (METERS_PER_DEGREE_LONGITUDE * Math.cos((((south + north) / 2) * Math.PI) / 180));
  return [west - lonDegrees, south - latDegrees, east + lonDegrees, north + latDegrees];
};

/**
 * The corridor `meters` either side of each stretch, as polygons whose bounds each
 * stay within the traffic API's cap: one for a city trip, several for a long one.
 * Neighbouring pieces overlap where they join, so their incidents are merged.
 */
const corridorAreas = (stretches: readonly Stretch[], meters: number): AreaBounds[] =>
  stretches.flatMap((stretch) => stretchCorridor(stretch, meters));

const stretchCorridor = ({ line: coordinates }: Stretch, meters: number): AreaBounds[] => {
  // About 55 m at most, and a quarter of a narrow
  // corridor's width, so the simplified line never cuts a bend out of the corridor.
  const tolerance = Math.min(0.0005, meters / 4 / METERS_PER_DEGREE_LONGITUDE);
  const line = turf.simplify(turf.lineString(coordinates), { tolerance });
  const chunks = turf
    .lineChunk(line, CORRIDOR_CHUNK_KM, { units: "kilometers" })
    .features.map((chunk) => chunk.geometry.coordinates);

  const pieces: (typeof chunks)[number][] = [];
  for (const chunk of chunks) {
    const last = pieces.at(-1);
    const joined = last && [...last, ...chunk.slice(1)];
    if (
      joined &&
      bboxAreaKm2(padded(turf.bbox(turf.lineString(joined)) as BBox, meters)) <=
        MAX_TRAFFIC_AREA_KM2
    ) {
      pieces[pieces.length - 1] = joined;
    } else {
      pieces.push(chunk);
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
  const { drive, routes, label } = await resolveDrive(
    where,
    "No driving route connects the locations, so there is no corridor to report on. Check " +
      'each location is reachable by road, or ask about an area with mode "within".'
  );
  const stretches = resolveStretches(drive, where.stretch);
  const route = routes?.features[0];
  const { lengthInMeters, travelTimeInSeconds } = drive.properties.summary;
  return {
    areas: corridorAreas(stretches, meters),
    // A planned route measures by its own progress; any other line by its length.
    metersAlong: route
      ? (position) => getProgressAtNearestRoutePoint(route, position)?.distanceInMeters
      : (position) =>
          turf.nearestPointOnLine(drive.geometry, position, { units: "meters" }).properties
            .location,
    searched: {
      scope: `within ${meters} m of ${label}`,
      route: {
        lengthInMeters,
        travelTimeInSeconds,
        trafficDelayInSeconds: route?.properties.summary.trafficDelayInSeconds,
      },
      ...(where.stretch && { stretch: describeStretches(stretches, drive) }),
    },
  };
};

/** The areas to query traffic for, and how to describe them. */
interface TrafficTargets {
  areas: AreaBounds[];
  searched: Record<string, unknown>;
  /** How far along the drive whose corridor the areas are a position lies, for mode `alongRoute`. */
  metersAlong?: (position: Position) => number | undefined;
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
  metersAlong: (position: Position) => number | undefined,
  response: TrafficIncidentDetails
): { response: TrafficIncidentDetails; startsAfterMeters: (number | undefined)[] } {
  const along = ({ geometry }: TrafficIncidentDetails["features"][number]): number | undefined => {
    const ends =
      geometry.type === "Point"
        ? [geometry.coordinates]
        : [geometry.coordinates[0], geometry.coordinates.at(-1)];
    const offsets = ends.flatMap((end) => (end ? (metersAlong(end) ?? []) : []));
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
    response: {
      ...response,
      features: located.map(({ feature, startsAfterMeters }) =>
        startsAfterMeters === undefined
          ? feature
          : { ...feature, properties: { ...feature.properties, startsAfterMeters } }
      ),
    },
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
 * area for `within`, by its bounding box or drawn polygon, and the corridor for `alongRoute`.
 *
 * @throws IncorrectError when a `nearby` point or an `alongRoute` location does not resolve.
 */
const resolveTrafficTargets = async (where: GetTrafficParams["where"]): Promise<TrafficTargets> => {
  if (where.mode === "alongRoute") return resolveCorridor(where);
  if (where.mode === "nearby") {
    const bias = await resolveNearby(where);
    return {
      areas: [circleOf(bias)],
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
  failures: readonly string[];
}): Record<string, unknown> => {
  const { mode, searched, queried, duplicates, oversized, failures } = coverage;
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
    // A total that silently covers part of the scope reads as a correct one unless it says so.
    ...(duplicates > 0 && {
      duplicatesMerged: duplicates,
      duplicatesNote:
        "Incidents found in more than one area were counted once: the areas overlap or share " +
        "a border.",
    }),
    ...(failures.length > 0 && {
      failedRequests: failures.length,
      note:
        `Part of the area could not be queried: ${[...new Set(failures)].join("; ")}. These ` +
        "results cover the rest. Treat totals as a lower bound.",
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
    const { areas: targets, searched, metersAlong } = await resolveTrafficTargets(where);

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

    const { succeeded, failures } = await queryAreas(
      requestGroups(withinCap),
      ({ bbox, polygon }) =>
        getTrafficIncidents(polygon ?? bbox, { language, categoryFilter, timeValidityFilter }),
      "Traffic lookup"
    );

    // One area has nothing to merge, and merging it anyway would let the dedupe
    // touch a result no overlap can affect.
    const { response: result, duplicates } =
      succeeded.length === 1
        ? { response: succeeded[0], duplicates: 0 }
        : mergeIncidents(succeeded);

    // Agent-facing incidents are capped. The traffic app draws live incidents itself,
    // so it takes only the searched bounds to frame, which a named area has once resolved.
    const keepTimeValidity = timeValidityFilter?.includes("future") ?? false;
    const capped = capTrafficIncidents(
      result,
      maxResults,
      metersAlong ? "inDrivingOrder" : "bySeverity"
    );
    const ordered = metersAlong && inDrivingOrder(metersAlong, capped);
    const searchedBounds = bboxFromBBoxes(withinCap.map(({ bbox }) => bbox));
    return await buildToolResponse(
      ordered ? ordered.response : capped,
      (response) => {
        const trimmed = trimTrafficResponse(response, keepTimeValidity);
        return ordered ? withStartsAfter(trimmed, ordered.startsAfterMeters) : trimmed;
      },
      {
        showUI: show_ui,
        responseDetail: response_detail,
        appData: { bbox: searchedBounds } satisfies TrafficAppData,
        geometry: incidentFeatures,
        dataset: {
          provenance: { tool: "tomtom-get-traffic", params },
          // Every incident found, not only those the cap shows, in driving order along a drive.
          data: metersAlong ? inDrivingOrder(metersAlong, result).response : result,
          // The counts over every incident; the fields about the rows shown don't apply.
          kept: () => {
            if (!capped.incidentSummary) return {};
            const {
              returnedIncidents: _returned,
              truncated: _truncated,
              note: _note,
              ...counts
            } = capped.incidentSummary;
            return { incidentSummary: counts };
          },
        },
        context: {
          searched: describeCoverage({
            mode: where.mode,
            searched,
            queried: withinCap.length,
            duplicates,
            oversized,
            failures,
          }),
          // A full result carries no app data, so the app frames on these bounds instead.
          ...(response_detail === "full" && { bbox: searchedBounds }),
        },
      }
    );
  } catch (error: unknown) {
    return buildErrorResponse(error, "Traffic lookup");
  }
}
