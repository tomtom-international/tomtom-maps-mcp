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
 * Live oracles for the demanding corpus: each recomputes a task's answer from
 * fresh TomTom data moments after the agent answered, so the judge scores the
 * answer against a value rather than against evidence it may only see abridged.
 *
 * They resolve names and fetch data through this tree's own resolvers and
 * services, which every phase from 1 on shares, so "Amsterdam" is the same area
 * for the oracle as for the agent's tools. The data is live: a count can move
 * between the agent's call and the oracle's, which each task's tolerance absorbs.
 */

import type { Moment, OpeningHours, Place, RouteProgressPoint } from "@tomtom-org/maps-sdk/core";
import * as turf from "@turf/turf";
import type { Feature, LineString, MultiPolygon, Polygon, Position } from "geojson";
import { getRoute } from "../../src/services/routing/routingService";
import { fuzzySearch, searchInAreas } from "../../src/services/search/searchService";
import { getTrafficIncidents } from "../../src/services/traffic/trafficService";
import { resolvePoiCategories } from "../../src/tools/shared/inputs/resolve-poi-categories";
import {
  boundariesOf,
  resolvePlaceName,
  resolveWithin,
  searchPlaceName,
} from "../../src/tools/shared/inputs/resolve-where";

/** What the judge is told the right answer is. */
export interface Reference {
  /** The answer in words and numbers, as the judge reads it. */
  answer: string;
}

/** A place name resolved as the tools resolve it. */
export async function pointOf(name: string): Promise<Position> {
  const resolved = await resolvePlaceName(name);
  if (!resolved) throw new Error(`oracle: could not resolve "${name}"`);
  return resolved.position;
}

/** A named area's boundary polygon, as tomtom-locate-place with response_detail "geometry" finds it. */
export async function boundaryOf(name: string): Promise<Polygon | MultiPolygon> {
  const {
    ranked: [place],
  } = await searchPlaceName(name);
  const [polygon] = place ? (await boundariesOf([place])).polygons : [];
  if (!polygon) throw new Error(`oracle: no boundary for "${name}"`);
  return polygon;
}

/** A named area resolved as `where: { mode: "within", queries: [name] }` resolves it. */
export async function areaOf(name: string): Promise<Polygon | MultiPolygon> {
  const [area] = await resolveWithin({ mode: "within", queries: [name] });
  return area.polygon ?? turf.bboxPolygon(area.bbox).geometry;
}

const categoryCodes = async (categories: string[]) => {
  const { resolved } = await resolvePoiCategories(categories);
  if (!resolved?.length) throw new Error(`oracle: no category for ${categories.join(", ")}`);
  return resolved;
};

/**
 * `upToLimit` when the question itself asks for at most `limit` places ("the 100 nearest"),
 * so a full page is the answer. Otherwise a full page means the cap cut the reference off.
 */
type SearchOptions = { limit?: number; minPowerKW?: number; upToLimit?: boolean };

const cappedError = (limit: number, where: string) =>
  new Error(
    `oracle: ${where} returned ${limit} places, a full page, so the reference would be capped`
  );

/** Places of `categories` within `radius` metres of a point, nearest first. */
export async function placesAround(
  categories: string[],
  position: Position,
  radius: number,
  options: SearchOptions = {}
): Promise<Place[]> {
  const limit = options.limit ?? 100;
  const { features } = await fuzzySearch("", {
    poiCategories: await categoryCodes(categories),
    position,
    radius,
    limit,
    ...(options.minPowerKW && { minPowerKW: options.minPowerKW }),
  });
  if (!options.upToLimit && features.length >= limit) {
    throw cappedError(limit, `a search within ${radius} m`);
  }
  return features as Place[];
}

/** The `limit` places of `categories` nearest a named point, within `radius` metres. */
export async function placesNear(
  categories: string[],
  near: string,
  radius: number,
  limit = 100
): Promise<Place[]> {
  return placesAround(categories, await pointOf(near), radius, { limit, upToLimit: true });
}

/** The most geometries the Search API takes in one request. */
const MAX_GEOMETRIES_PER_REQUEST = 50;

/**
 * Places of `categories` inside the given areas, each place once. Searched in requests of
 * up to 50 areas, one at a time since the services do not retry a rate-limited request, and
 * a request that comes back full is split in two until none does.
 */
export async function placesIn(
  categories: string[],
  areas: (Polygon | MultiPolygon)[],
  options: SearchOptions = {}
): Promise<Place[]> {
  const poiCategories = await categoryCodes(categories);
  const limit = options.limit ?? 100;
  const search = async (batch: (Polygon | MultiPolygon)[]): Promise<Place[]> => {
    const { features } = await searchInAreas("", batch, {
      poiCategories,
      limit,
      ...(options.minPowerKW && { minPowerKW: options.minPowerKW }),
    });
    if (options.upToLimit || features.length < limit) return features as Place[];
    if (batch.length === 1) throw cappedError(limit, "a search in one area");
    const half = Math.ceil(batch.length / 2);
    return [...(await search(batch.slice(0, half))), ...(await search(batch.slice(half)))];
  };
  const batches: (Polygon | MultiPolygon)[][] = [];
  for (let start = 0; start < areas.length; start += MAX_GEOMETRIES_PER_REQUEST) {
    batches.push(areas.slice(start, start + MAX_GEOMETRIES_PER_REQUEST));
  }
  const places: Place[] = [];
  for (const batch of batches) places.push(...(await search(batch)));
  return [...new Map(places.map((place) => [place.id, place])).values()];
}

/** Every current traffic incident in a named area, uncapped. */
export async function incidentsIn(
  name: string,
  options: Parameters<typeof getTrafficIncidents>[1] = {}
) {
  return (await getTrafficIncidents(await areaOf(name), options)).features;
}

/** The fastest route between named places, with guidance, as `plan-route` asks for it. */
export async function routeBetween(names: string[]) {
  const positions = await Promise.all(names.map(pointOf));
  const routes = await getRoute(positions, {}, { guidance: true });
  const [route] = routes.features;
  if (!route) throw new Error(`oracle: no route for ${names.join(" → ")}`);
  return route;
}

export const placeLabel = (place: Place): string =>
  place.properties.poi?.name ?? place.properties.address?.freeformAddress ?? "(unnamed)";

/** A place's name with its address, for places that share a name, such as charger operators. */
export const placeWithAddress = (place: Place): string =>
  `${placeLabel(place)}, ${place.properties.address?.freeformAddress ?? "no address"}`;

/** Metres from a point to the nearest part of an incident's geometry. */
export function metresToGeometry(point: Position, geometry: Feature["geometry"]): number {
  if (geometry.type === "Point")
    return turf.distance(point, geometry.coordinates, { units: "meters" });
  if (geometry.type === "LineString") {
    return turf.pointToLineDistance(point, geometry as LineString, { units: "meters" });
  }
  if (geometry.type === "MultiLineString") {
    return Math.min(
      ...geometry.coordinates.map((line) =>
        turf.pointToLineDistance(point, turf.lineString(line), { units: "meters" })
      )
    );
  }
  return turf.distance(point, turf.centroid(geometry).geometry.coordinates, { units: "meters" });
}

/** Metres along a line to the point on it nearest `point`. */
export const metresAlong = (line: LineString, point: Position): number =>
  turf.nearestPointOnLine(line, point, { units: "meters" }).properties.location ?? 0;

/** A local wall-clock time, as an opening-hours `Moment` carries it. */
type LocalTime = Pick<Moment, "year" | "month" | "day" | "hour" | "minute">;

/** A local calendar date. */
type LocalDate = Pick<Moment, "year" | "month" | "day">;

/** Local wall-clock parts in a time zone, for comparing with opening-hours ranges. */
function localParts(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map(({ type, value }) => [type, value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: parts.weekday as string,
  };
}

/** A sortable key for a local wall-clock time. */
const timeKey = ({ year, month, day, hour, minute }: LocalTime): number =>
  (((year * 100 + month) * 100 + day) * 100 + hour) * 100 + minute;

const rangesOf = (place: Place): OpeningHours["timeRanges"] | undefined =>
  place.properties.poi?.openingHours?.timeRanges;

/** Whether a place's opening hours cover a local time; undefined when it has none. */
export function openAt(place: Place, at: LocalTime): boolean | undefined {
  const ranges = rangesOf(place);
  if (!ranges) return undefined;
  const key = timeKey(at);
  return ranges.some(({ start, end }) => timeKey(start) <= key && key < timeKey(end));
}

/** The coming `weekday` ("Mon" … "Sun") in a time zone: today when it is that day. */
export function comingWeekday(weekday: string, timeZone: string): LocalDate {
  for (let offset = 0; offset < 7; offset += 1) {
    const parts = localParts(new Date(Date.now() + offset * 86_400_000), timeZone);
    if (parts.weekday === weekday) return { year: parts.year, month: parts.month, day: parts.day };
  }
  throw new Error(`oracle: no ${weekday} in the coming week`);
}

/** The earliest local opening time on a date, as "HH:MM"; undefined when it doesn't open that day. */
export function opensOn(place: Place, date: LocalDate) {
  const dayStart = timeKey({ ...date, hour: 0, minute: 0 });
  const dayEnd = timeKey({ ...date, hour: 23, minute: 59 });
  // The API splits a night's opening at midnight, so a range starting at 00:00 is
  // the night before carrying over, not an opening.
  const starts = (rangesOf(place) ?? [])
    .map(({ start }) => timeKey(start))
    .filter((key) => key > dayStart && key <= dayEnd);
  if (!starts.length) return undefined;
  const earliest = Math.min(...starts) % 10_000;
  return `${String(Math.floor(earliest / 100)).padStart(2, "0")}:${String(earliest % 100).padStart(2, "0")}`;
}

/** A date as a prompt names it: "Saturday 7 November 2026". */
export const dateLabel = ({ year, month, day }: LocalDate) =>
  new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

/** Whether a place is open for the whole of the next seven days, by the API's own flag. */
export const alwaysOpen = (place: Place): boolean | undefined =>
  place.properties.poi?.openingHours?.alwaysOpenThisPeriod;

/** Seconds of driving to a vertex of a route, interpolated between its progress points. */
export function secondsToVertex(progress: readonly RouteProgressPoint[], index: number): number {
  const after = progress.findIndex(({ pointIndex }) => pointIndex >= index);
  if (after < 0) return progress.at(-1)?.travelTimeInSeconds ?? 0;
  if (after === 0) return progress[0].travelTimeInSeconds ?? 0;
  const [a, b] = [progress[after - 1], progress[after]];
  const share = (index - a.pointIndex) / (b.pointIndex - a.pointIndex);
  return (
    (a.travelTimeInSeconds ?? 0) +
    share * ((b.travelTimeInSeconds ?? 0) - (a.travelTimeInSeconds ?? 0))
  );
}

/** Counts by key, most first. */
export function tally<T>(items: readonly T[], key: (item: T) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}
