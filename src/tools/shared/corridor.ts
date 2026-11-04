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
 * The places search along a drive by distance: a corridor of polygons the
 * Search API takes as drawn, searched in driving order, each place kept only
 * when it lies within the corridor's width of the stretches themselves.
 */

import type { Places } from "@tomtom-org/maps-sdk/core";
import * as turf from "@turf/turf";
import type { Polygon, Position } from "geojson";
import { METERS_PER_DEGREE_LONGITUDE } from "../../services/map/geometryUtils";
import { dedupeBy } from "./in-batches";
import { type AlongRoutePosition, positionAlong, type Stretch } from "./inputs/route-stretch";

/**
 * The Search API's caps on one geometry search: polygons per request, vertices
 * per polygon, results per request. The SDK samples a longer outline down to 50
 * vertices, which cuts a long corridor's bends off.
 */
const MAX_GEOMETRIES = 50;
const MAX_POLYGON_VERTICES = 50;
const MAX_RESULTS = 100;

/** Most requests one corridor search makes, splitting a group whose results hit the cap. */
export const MAX_CORRIDOR_REQUESTS = 10;

/**
 * How far simplifying the line, then each polygon's outline, may move them, as
 * shares of the corridor's width. Each polygon is drawn that much wider, so
 * neither ever brings it inside the corridor.
 */
const LINE_TOLERANCE = 0.2;
const OUTLINE_TOLERANCE = 0.2;

/** One polygon of a corridor, the line it was drawn around, and where that runs along the drive. */
interface CorridorPiece {
  polygon: Polygon;
  vertices: Position[];
  fromMeters: number;
  toMeters: number;
}

/** The polygon around `vertices`, simplified, or undefined when its outline stays over the cap. */
function outlineOf(vertices: Position[], meters: number): Polygon | undefined {
  const radius = meters * (1 + LINE_TOLERANCE + OUTLINE_TOLERANCE);
  const buffered = turf.buffer(turf.lineString(vertices), radius, { units: "meters", steps: 4 });
  if (buffered?.geometry.type !== "Polygon") return undefined;
  const outline = turf.simplify(turf.polygon([buffered.geometry.coordinates[0]]), {
    tolerance: (meters * OUTLINE_TOLERANCE) / METERS_PER_DEGREE_LONGITUDE,
    highQuality: true,
  }).geometry;
  return outline.coordinates[0].length - 1 <= MAX_POLYGON_VERTICES ? outline : undefined;
}

/**
 * The corridor around `vertices` as pieces of at most {@link MAX_POLYGON_VERTICES}
 * vertices, in order: a line whose outline would be longer is halved until each
 * half's is not.
 */
function piecesOf(
  vertices: Position[],
  stretches: readonly Stretch[],
  meters: number
): CorridorPiece[] {
  const polygon = outlineOf(vertices, meters);
  if (!polygon && vertices.length > 2) {
    const middle = Math.floor(vertices.length / 2);
    return [
      ...piecesOf(vertices.slice(0, middle + 1), stretches, meters),
      ...piecesOf(vertices.slice(middle), stretches, meters),
    ];
  }
  if (!polygon) throw new Error("A one-segment corridor piece gave no outline");
  const [fromMeters, toMeters] = [vertices[0], vertices[vertices.length - 1]].map(
    (end) => positionAlong(stretches, end)?.meters ?? 0
  );
  return [{ polygon, vertices, fromMeters, toMeters }];
}

/**
 * A piece cut in two at half its length, for a search whose results hit the cap;
 * undefined when it is too short to cut, its halves mostly overlapping.
 */
function halve(
  piece: CorridorPiece,
  stretches: readonly Stretch[],
  meters: number
): CorridorPiece[] | undefined {
  const line = turf.lineString(piece.vertices);
  const length = turf.length(line, { units: "meters" });
  if (length < 4 * meters) return undefined;
  return [
    [0, length / 2],
    [length / 2, length],
  ].flatMap(([from, to]) =>
    piecesOf(
      turf.lineSliceAlong(line, from, to, { units: "meters" }).geometry.coordinates,
      stretches,
      meters
    )
  );
}

/**
 * The corridor `meters` either side of each stretch, as polygons of at most
 * {@link MAX_POLYGON_VERTICES} vertices, in driving order.
 */
export function corridorPieces(stretches: readonly Stretch[], meters: number): CorridorPiece[] {
  return stretches.flatMap(({ line }) =>
    piecesOf(
      turf.simplify(turf.lineString(line), {
        tolerance: (meters * LINE_TOLERANCE) / METERS_PER_DEGREE_LONGITUDE,
        highQuality: true,
      }).geometry.coordinates,
      stretches,
      meters
    )
  );
}

type Place = Places["features"][number];

/** A place with where along the drive it lies. */
type WithAlongRoute<T extends Place> = T & {
  properties: T["properties"] & { alongRoute: AlongRoutePosition };
};

type PlaceAlongRoute = WithAlongRoute<Place>;

/** `place` with where along the drive it lies, rounded to whole metres and seconds. */
export function placeAlongRoute<T extends Place>(
  place: T,
  stretches: readonly Stretch[]
): WithAlongRoute<T> | undefined {
  const along = positionAlong(stretches, place.geometry.coordinates);
  if (!along) return undefined;
  return {
    ...place,
    properties: {
      ...place.properties,
      alongRoute: {
        meters: Math.round(along.meters),
        seconds: Math.round(along.seconds),
        offRouteMeters: Math.round(along.offRouteMeters),
      },
    },
  };
}

interface CorridorResult {
  places: PlaceAlongRoute[];
  /** Every place found in the corridor, past `limit` too; all it holds when `incomplete` is empty and every group was searched. */
  matched: { count: number; exact: boolean };
  requests: number;
  /** The stretches, in metres from the start, whose search hit the result cap or was never made. */
  incomplete: { fromMeters: number; toMeters: number }[];
}

/** A group whose results hit the cap, as smaller groups to search instead; undefined when it will not split. */
function split(
  group: CorridorPiece[],
  stretches: readonly Stretch[],
  meters: number
): CorridorPiece[][] | undefined {
  if (group.length > 1) {
    const middle = Math.ceil(group.length / 2);
    return [group.slice(0, middle), group.slice(middle)];
  }
  return halve(group[0], stretches, meters)?.map((piece) => [piece]);
}

/**
 * The places within `meters` of the stretches, in driving order, up to `limit`.
 * Groups of pieces are searched in driving order, and a group whose results hit
 * the cap is split and searched again, so the places returned are the first
 * `limit` the drive reaches, not whichever the API picked. It stops once the
 * groups searched in full hold `limit` places; a capped search's places are kept
 * too, for when the request budget runs out first.
 */
export async function searchCorridor(
  stretches: readonly Stretch[],
  meters: number,
  limit: number,
  search: (polygons: Polygon[], limit: number) => Promise<Places>
): Promise<CorridorResult> {
  const pieces = corridorPieces(stretches, meters);
  const queue: CorridorPiece[][] = [];
  for (let index = 0; index < pieces.length; index += MAX_GEOMETRIES) {
    queue.push(pieces.slice(index, index + MAX_GEOMETRIES));
  }

  const found: PlaceAlongRoute[] = [];
  const settled = new Set<string>();
  const incomplete: CorridorResult["incomplete"] = [];
  const span = (group: CorridorPiece[]) => ({
    fromMeters: Math.round(group[0].fromMeters),
    toMeters: Math.round(group[group.length - 1].toMeters),
  });
  let requests = 0;
  while (settled.size < limit) {
    const group = queue.shift();
    if (!group) break;
    if (requests >= MAX_CORRIDOR_REQUESTS) {
      incomplete.push(span(group), ...queue.map(span));
      break;
    }
    const result = await search(
      group.map(({ polygon }) => polygon),
      MAX_RESULTS
    );
    requests++;
    const capped = result.features.length >= MAX_RESULTS;
    const located = result.features.flatMap((place) => {
      const along = placeAlongRoute(place, stretches);
      return along && along.properties.alongRoute.offRouteMeters <= meters ? [along] : [];
    });
    found.push(...located);
    if (!capped) {
      for (const { id } of located) settled.add(String(id));
      continue;
    }
    const smaller = split(group, stretches, meters);
    if (smaller) queue.unshift(...smaller);
    else incomplete.push(span(group));
  }

  const unique = dedupeBy(found, ({ id }) => String(id)).unique.sort(
    (a, b) => a.properties.alongRoute.meters - b.properties.alongRoute.meters
  );
  return {
    places: unique.slice(0, limit),
    matched: { count: unique.length, exact: !queue.length && !incomplete.length },
    requests,
    incomplete: joined(incomplete),
  };
}

/** Spans that touch or overlap joined into one, in order. */
const joined = (spans: CorridorResult["incomplete"]): CorridorResult["incomplete"] =>
  [...spans]
    .sort((a, b) => a.fromMeters - b.fromMeters)
    .reduce<CorridorResult["incomplete"]>((merged, span) => {
      const last = merged.at(-1);
      if (last && span.fromMeters <= last.toMeters)
        last.toMeters = Math.max(last.toMeters, span.toMeters);
      else merged.push({ ...span });
      return merged;
    }, []);
