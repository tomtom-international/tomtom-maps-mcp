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
 * Turns a `stretch` into the stretches of a planned route it picks: its window,
 * kept to the included countries and section types, less the excluded ones.
 * Each comes back as its own line, with the distance and driving time from the
 * route's start at every vertex, so a search runs on just that part and a
 * result found along it says where on the drive it is.
 */

import type {
  Route,
  RouteProgressAtPoint,
  RouteProgressPoint,
  SectionProps,
} from "@tomtom-org/maps-sdk/core";
import * as turf from "@turf/turf";
import type { Position } from "geojson";
import {
  type RouteStretch,
  STRETCH_SECTION_TYPES,
  type StretchSectionType,
} from "../../../schemas/shared/alongRoute";
import {
  METERS_PER_DEGREE_LATITUDE,
  METERS_PER_DEGREE_LONGITUDE,
} from "../../../services/map/geometryUtils";
import { IncorrectError } from "../../../types/types";

/** A stretch shorter than this is a sliver where two sections meet, not a part of the drive. */
const MIN_STRETCH_METERS = 10;

/** One part of a route: its line, and the distance and time from the route's start at each vertex. */
export interface Stretch {
  fromMeters: number;
  toMeters: number;
  line: Position[];
  meters: number[];
  seconds: number[];
  /** The line's own length up to each vertex, to read a point snapped onto it against `meters`. */
  lineMeters: number[];
  /** Runs of the line's vertices with their bounds, so a point is snapped only to the runs near it. */
  chunks: Chunk[];
}

interface Chunk {
  start: number;
  end: number;
  bbox: [west: number, south: number, east: number, north: number];
}

/** Vertices per {@link Chunk}: snapping to a line of thousands of vertices takes milliseconds a point. */
const CHUNK_VERTICES = 64;

const chunksOf = (line: readonly Position[]): Chunk[] => {
  const chunks: Chunk[] = [];
  for (let start = 0; start < line.length - 1; start += CHUNK_VERTICES) {
    const end = Math.min(start + CHUNK_VERTICES, line.length - 1);
    const run = line.slice(start, end + 1);
    const lons = run.map(([lon]) => lon);
    const lats = run.map(([, lat]) => lat);
    chunks.push({
      start,
      end,
      bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
    });
  }
  return chunks;
};

/** At most the distance from `point` to anything inside `bbox`, in metres. */
const distanceToBox = ([lon, lat]: Position, [west, south, east, north]: Chunk["bbox"]): number => {
  const dx =
    Math.max(0, west - lon, lon - east) *
    METERS_PER_DEGREE_LONGITUDE *
    Math.cos((lat * Math.PI) / 180);
  const dy = Math.max(0, south - lat, lat - north) * METERS_PER_DEGREE_LATITUDE;
  // A little under the flat-earth distance, which runs slightly over the great-circle one.
  return 0.99 * Math.hypot(dx, dy);
};

/** Where a point lies along the drive, measured from the route's start. */
export interface AlongRoutePosition {
  meters: number;
  seconds: number;
  offRouteMeters: number;
}

type Span = [from: number, to: number];

/** The distance and driving time from the start at each route point. */
interface RouteMeasure {
  coordinates: Position[];
  meters: number[];
  seconds: number[];
}

/** The length of `line` up to each of its vertices. */
const lengthsAlong = (line: readonly Position[]): number[] => {
  const along = [0];
  for (let index = 1; index < line.length; index++) {
    along.push(along[index - 1] + turf.distance(line[index - 1], line[index], { units: "meters" }));
  }
  return along;
};

/**
 * The route's own distance and time at each point: the line's length between
 * `progress` entries, scaled to the distance and time the route reports there.
 */
function measure(route: Route): RouteMeasure {
  const coordinates = route.geometry.coordinates;
  const along = lengthsAlong(coordinates);
  const { lengthInMeters, travelTimeInSeconds } = route.properties.summary;
  const progress = (route.properties.progress ?? []).filter(
    (entry): entry is RouteProgressPoint & RouteProgressAtPoint =>
      entry.distanceInMeters !== undefined && entry.travelTimeInSeconds !== undefined
  );
  if (progress.at(0)?.pointIndex !== 0 || progress.at(-1)?.pointIndex !== coordinates.length - 1) {
    progress.splice(
      0,
      progress.length,
      { pointIndex: 0, distanceInMeters: 0, travelTimeInSeconds: 0 },
      {
        pointIndex: coordinates.length - 1,
        distanceInMeters: lengthInMeters,
        travelTimeInSeconds,
      }
    );
  }

  const meters = new Array<number>(coordinates.length);
  const seconds = new Array<number>(coordinates.length);
  for (let entry = 0; entry < progress.length - 1; entry++) {
    const start = progress[entry];
    const end = progress[entry + 1];
    const lineLength = along[end.pointIndex] - along[start.pointIndex];
    for (let index = start.pointIndex; index <= end.pointIndex; index++) {
      const share = lineLength > 0 ? (along[index] - along[start.pointIndex]) / lineLength : 0;
      meters[index] =
        start.distanceInMeters + share * (end.distanceInMeters - start.distanceInMeters);
      seconds[index] =
        start.travelTimeInSeconds + share * (end.travelTimeInSeconds - start.travelTimeInSeconds);
    }
  }
  return { coordinates, meters, seconds };
}

/** The first index whose value is above `value`, in an ascending array. */
const firstAbove = (values: readonly number[], value: number): number => {
  let [low, high] = [0, values.length];
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return low;
};

/** `to` read off `from`'s scale at `value`: the metres at a driving time, say. */
const interpolate = (from: readonly number[], to: readonly number[], value: number): number => {
  const above = Math.min(Math.max(firstAbove(from, value), 1), from.length - 1);
  const [low, high] = [from[above - 1], from[above]];
  const share = high > low ? (value - low) / (high - low) : 0;
  return to[above - 1] + share * (to[above] - to[above - 1]);
};

/** The position `meters` from the start, between the route points either side. */
const positionAt = ({ coordinates, meters }: RouteMeasure, at: number): Position => {
  const above = Math.min(Math.max(firstAbove(meters, at), 1), meters.length - 1);
  const [low, high] = [meters[above - 1], meters[above]];
  const share = high > low ? (at - low) / (high - low) : 0;
  const [startLon, startLat] = coordinates[above - 1];
  const [endLon, endLat] = coordinates[above];
  return [startLon + share * (endLon - startLon), startLat + share * (endLat - startLat)];
};

/** Overlapping and touching spans joined, in order. */
const union = (spans: readonly Span[]): Span[] => {
  const merged: Span[] = [];
  for (const [from, to] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
};

const intersect = (spans: readonly Span[], keep: readonly Span[]): Span[] =>
  spans.flatMap(([from, to]) =>
    keep.flatMap(([keepFrom, keepTo]): Span[] => {
      const [start, end] = [Math.max(from, keepFrom), Math.min(to, keepTo)];
      return start < end ? [[start, end]] : [];
    })
  );

const subtract = (spans: readonly Span[], remove: readonly Span[]): Span[] =>
  remove.reduce<Span[]>(
    (left, [removeFrom, removeTo]) =>
      left.flatMap(([from, to]): Span[] => [
        ...(from < Math.min(to, removeFrom) ? [[from, Math.min(to, removeFrom)] as Span] : []),
        ...(Math.max(from, removeTo) < to ? [[Math.max(from, removeTo), to] as Span] : []),
      ]),
    [...spans]
  );

const spansOf = (sections: readonly SectionProps[] | undefined, { meters }: RouteMeasure): Span[] =>
  union(
    (sections ?? []).map(({ startPointIndex, endPointIndex }) => [
      meters[startPointIndex],
      meters[endPointIndex],
    ])
  );

const sectionSpans = (route: Route, measured: RouteMeasure, types: readonly StretchSectionType[]) =>
  union(types.flatMap((type) => spansOf(route.properties.sections[type], measured)));

const countrySpans = (route: Route, measured: RouteMeasure, codes: readonly string[]) => {
  const wanted = new Set(codes.map((code) => code.toUpperCase()));
  return spansOf(
    route.properties.sections.country?.filter(({ countryCodeISO2 }) => wanted.has(countryCodeISO2)),
    measured
  );
};

const kilometres = (meters: number): number => Math.round(meters / 100) / 10;

/** What a stretch can pick on this route: its length, countries and section types. */
function routeParts(route: Route, measured: RouteMeasure, types: readonly StretchSectionType[]) {
  const countries: Record<string, number> = {};
  for (const { countryCodeISO2, startPointIndex, endPointIndex } of route.properties.sections
    .country ?? []) {
    countries[countryCodeISO2] =
      (countries[countryCodeISO2] ?? 0) +
      measured.meters[endPointIndex] -
      measured.meters[startPointIndex];
  }
  const sections: Record<string, number> = {};
  for (const type of types) {
    const length = sectionSpans(route, measured, [type]).reduce(
      (sum, [from, to]) => sum + to - from,
      0
    );
    if (length > 0) sections[type] = kilometres(length);
  }
  return {
    lengthKm: kilometres(measured.meters.at(-1) ?? 0),
    travelTimeMinutes: Math.round((measured.seconds.at(-1) ?? 0) / 60),
    countriesKm: Object.fromEntries(
      Object.entries(countries).map(([code, length]) => [code, kilometres(length)])
    ),
    sectionsKm: sections,
  };
}

/** The window a stretch gives, in metres from the start: the whole route when it gives none. */
function windowOf(
  { from, to, unit = "meters", lastMeters }: RouteStretch,
  { meters, seconds }: RouteMeasure
): Span {
  const length = meters.at(-1) ?? 0;
  if (lastMeters !== undefined) return [Math.max(0, length - lastMeters), length];
  const toMeters: Record<typeof unit, (value: number) => number> = {
    meters: (value) => value,
    seconds: (value) => interpolate(seconds, meters, value),
    percent: (value) => (length * value) / 100,
  };
  return [
    from === undefined ? 0 : toMeters[unit](from),
    to === undefined ? length : Math.min(toMeters[unit](to), length),
  ];
}

/** The part of the route between two distances, as its own line with its distances and times. */
function cut(measured: RouteMeasure, [from, to]: Span): Stretch {
  const first = firstAbove(measured.meters, from);
  const last = firstAbove(measured.meters, to);
  const inner = Array.from(
    { length: Math.max(0, last - first) },
    (_, offset) => first + offset
  ).filter((index) => measured.meters[index] < to);
  const secondsAt = (meters: number) => interpolate(measured.meters, measured.seconds, meters);
  const line = [
    positionAt(measured, from),
    ...inner.map((index) => measured.coordinates[index]),
    positionAt(measured, to),
  ];
  return {
    fromMeters: from,
    toMeters: to,
    line,
    meters: [from, ...inner.map((index) => measured.meters[index]), to],
    seconds: [secondsAt(from), ...inner.map((index) => measured.seconds[index]), secondsAt(to)],
    lineMeters: lengthsAlong(line),
    chunks: chunksOf(line),
  };
}

/**
 * `spans` kept to the included countries and sections, less the excluded ones.
 *
 * @throws IncorrectError when an included country or section is not on the route.
 */
function filtered(
  spans: Span[],
  stretch: RouteStretch,
  route: Route,
  measured: RouteMeasure,
  parts: () => ReturnType<typeof routeParts>
): Span[] {
  let kept = spans;
  if (stretch.includeCountries) {
    const countries = countrySpans(route, measured, stretch.includeCountries);
    if (!countries.length) {
      throw new IncorrectError(
        "The drive crosses none of the countries in `includeCountries`; `countriesKm` lists the " +
          "ones it does cross.",
        { includeCountries: stretch.includeCountries, ...parts() }
      );
    }
    kept = intersect(kept, countries);
  }
  if (stretch.includeSections) {
    const sections = sectionSpans(route, measured, stretch.includeSections);
    if (!sections.length) {
      throw new IncorrectError(
        "The drive has none of the sections in `includeSections`; `sectionsKm` lists the ones it has.",
        { includeSections: stretch.includeSections, ...parts() }
      );
    }
    kept = intersect(kept, sections);
  }
  if (stretch.excludeCountries) {
    kept = subtract(kept, countrySpans(route, measured, stretch.excludeCountries));
  }
  if (stretch.excludeSections) {
    kept = subtract(kept, sectionSpans(route, measured, stretch.excludeSections));
  }
  return kept;
}

/**
 * The stretches of `route` that `stretch` picks, in driving order; the whole
 * route when there is no `stretch`.
 *
 * @throws IncorrectError when the window misses the route, or nothing of it is
 *   left: the error says what the route has to pick from.
 */
export function resolveStretches(route: Route, stretch?: RouteStretch): Stretch[] {
  if (route.geometry.coordinates.length < 2) {
    if (stretch)
      throw new IncorrectError("The planned route has no geometry to pick a stretch from.");
    return [];
  }
  const measured = measure(route);
  if (!stretch) return [cut(measured, [0, measured.meters.at(-1) ?? 0])];

  const length = measured.meters.at(-1) ?? 0;
  const parts = () => routeParts(route, measured, STRETCH_SECTION_TYPES);
  const window = windowOf(stretch, measured);
  if (window[0] >= length) {
    throw new IncorrectError(
      "The stretch starts after the drive ends; `lengthKm` and `travelTimeMinutes` say how long " +
        "the drive is.",
      parts()
    );
  }

  const spans = filtered([window], stretch, route, measured, parts).filter(
    ([from, to]) => to - from >= MIN_STRETCH_METERS
  );
  if (!spans.length) {
    throw new IncorrectError(
      "Nothing of the drive is left once the stretch's window, includes and excludes are " +
        "applied. Widen the window or drop a filter; the details list what the drive has.",
      parts()
    );
  }
  return spans.map((span) => cut(measured, span));
}

/** The stretches as `searched.stretch` reports them. */
export const describeStretches = (stretches: readonly Stretch[], route: Route) => ({
  stretches: stretches.map(({ fromMeters, toMeters }) => ({
    fromMeters: Math.round(fromMeters),
    toMeters: Math.round(toMeters),
  })),
  searchedMeters: Math.round(
    stretches.reduce((sum, { fromMeters, toMeters }) => sum + toMeters - fromMeters, 0)
  ),
  routeMeters: route.properties.summary.lengthInMeters,
});

/** Where `point` lies along the nearest of `stretches`, measured from the route's start. */
export function positionAlong(
  stretches: readonly Stretch[],
  point: Position
): AlongRoutePosition | undefined {
  const candidates = stretches
    .flatMap((stretch) =>
      stretch.chunks.map((chunk) => ({ stretch, chunk, bound: distanceToBox(point, chunk.bbox) }))
    )
    .sort((a, b) => a.bound - b.bound);
  let best: AlongRoutePosition | undefined;
  for (const { stretch, chunk, bound } of candidates) {
    if (best && bound > best.offRouteMeters) break;
    const { line, meters, seconds, lineMeters } = stretch;
    const run = turf.lineString(line.slice(chunk.start, chunk.end + 1));
    const nearest = turf.nearestPointOnLine(run, point, { units: "meters" });
    // `lineDistance`, not `segmentDistance`, which is a whole segment off at a vertex.
    const { pointDistance: offRouteMeters, lineDistance } = nearest.properties;
    if (best && best.offRouteMeters <= offRouteMeters) continue;
    const along = lineMeters[chunk.start] + lineDistance;
    best = {
      meters: interpolate(lineMeters, meters, along),
      seconds: interpolate(lineMeters, seconds, along),
      offRouteMeters,
    };
  }
  return best;
}
