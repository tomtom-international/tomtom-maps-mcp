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

// response_detail "geometry": the compact response plus a `geometry` key
// holding a normalised GeoJSON FeatureCollection (docs/adr/0003 to 0007).
//
// - Coordinates are [longitude, latitude], rounded to 5 decimals.
// - One feature per geometric item. Its properties are a join key giving the
//   item's position in the compact response, plus `simplification` when the
//   vertex cap applied.
// - Properties are always built here. SDK properties are never copied: they
//   can carry request params, including the API key.

import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import type { TrafficResponse } from "./response-trimmer";
import { capPaths, roundPosition, VERTEX_CAP } from "./simplify";

export type GeometryProperties = Record<string, string | number | object>;
export type GeometryFeature = Feature<Geometry, GeometryProperties>;
export type GeometryCollection = FeatureCollection<Geometry, GeometryProperties>;

interface RawGeometry {
  type?: unknown;
  coordinates?: unknown;
}

const isPosition = (value: unknown): value is Position =>
  Array.isArray(value) &&
  value.length >= 2 &&
  typeof value[0] === "number" &&
  typeof value[1] === "number";

export const isPath = (value: unknown): value is Position[] =>
  Array.isArray(value) && value.length > 0 && value.every(isPosition);

const withSimplification = (
  properties: GeometryProperties,
  simplification: ReturnType<typeof capPaths>["simplification"]
): GeometryProperties => (simplification ? { ...properties, simplification } : properties);

/**
 * Builds one capped, rounded feature from a raw geometry and a join key.
 * Only `type` and `coordinates` are read from the input.
 */
export function toFeature(
  raw: RawGeometry | undefined,
  properties: GeometryProperties
): GeometryFeature | null {
  const coordinates = raw?.coordinates;
  switch (raw?.type) {
    case "Point":
      if (!isPosition(coordinates)) return null;
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: roundPosition(coordinates) },
        properties,
      };
    case "LineString": {
      if (!isPath(coordinates) || coordinates.length < 2) return null;
      const capped = capPaths([coordinates], { rings: false });
      return {
        type: "Feature",
        geometry: { type: "LineString", coordinates: capped.paths[0] },
        properties: withSimplification(properties, capped.simplification),
      };
    }
    case "MultiLineString": {
      if (!Array.isArray(coordinates) || !coordinates.every(isPath)) return null;
      const capped = capPaths(coordinates, { rings: false });
      return {
        type: "Feature",
        geometry: { type: "MultiLineString", coordinates: capped.paths },
        properties: withSimplification(properties, capped.simplification),
      };
    }
    case "Polygon": {
      if (!Array.isArray(coordinates) || !coordinates.length || !coordinates.every(isPath)) {
        return null;
      }
      const capped = capPaths(coordinates.map(closeRing), { rings: true });
      return {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: capped.paths },
        properties: withSimplification(properties, capped.simplification),
      };
    }
    case "MultiPolygon": {
      if (
        !Array.isArray(coordinates) ||
        !coordinates.length ||
        !coordinates.every((polygon) => Array.isArray(polygon) && polygon.every(isPath))
      ) {
        return null;
      }
      const capped = capMultiPolygon(
        (coordinates as Position[][][]).map((polygon) => polygon.map(closeRing))
      );
      return {
        type: "Feature",
        geometry: { type: "MultiPolygon", coordinates: capped.parts },
        properties: withSimplification(properties, capped.simplification),
      };
    }
    default:
      return null;
  }
}

const sizeOf = (rings: Position[][]): number => rings.reduce((sum, ring) => sum + ring.length, 0);

/**
 * Caps a MultiPolygon's parts. Each part takes its share of the one vertex budget
 * and is checked for crossings on its own: areas merged into one outline can share
 * a border, which a check across parts would read as a crossing and never simplify.
 */
function capMultiPolygon(polygons: Position[][][]): {
  parts: Position[][][];
  simplification: ReturnType<typeof capPaths>["simplification"];
} {
  const total = polygons.reduce((sum, rings) => sum + sizeOf(rings), 0);
  const capped = polygons.map((rings) =>
    capPaths(rings, {
      rings: true,
      cap: Math.max(4 * rings.length, Math.floor((VERTEX_CAP * sizeOf(rings)) / total)),
    })
  );
  const parts = capped.map(({ paths }) => paths);
  const simplified = capped.flatMap(({ simplification }) => simplification ?? []);
  if (!simplified.length) return { parts, simplification: undefined };
  return {
    parts,
    simplification: {
      original_points: total,
      points: parts.reduce((sum, rings) => sum + sizeOf(rings), 0),
      max_error_m: Math.max(...simplified.map(({ max_error_m }) => max_error_m)),
    },
  };
}

function closeRing(ring: Position[]): Position[] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
}

export function featureCollection(
  features: Array<GeometryFeature | null | undefined>
): GeometryCollection {
  return {
    type: "FeatureCollection",
    features: features.filter((f): f is GeometryFeature => Boolean(f)),
  };
}

/** The keys whose values are vertex indices into a route line. */
export const POINT_INDEX_KEYS: ReadonlySet<string> = new Set([
  "startPointIndex",
  "endPointIndex",
  "pointIndex",
]);

/**
 * Removes every vertex index (route sections, legs, progress, guidance) from a
 * compact response. They point into the API's original line, which the
 * simplified geometry no longer matches (ADR 0006).
 */
export function stripPointIndexes<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripPointIndexes) as T;
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (!POINT_INDEX_KEYS.has(key)) out[key] = stripPointIndexes(child);
  }
  return out as T;
}

/** The body of a geometry response: compact, without vertex indexes, plus `geometry`. */
export function withGeometry(
  compact: unknown,
  geometry: GeometryCollection
): Record<string, unknown> {
  return { ...(stripPointIndexes(compact) as object), geometry };
}

interface RouteFeatureLike {
  geometry?: RawGeometry | null;
  properties?: Record<string, unknown> | null;
}

interface GeoJSONRoutes {
  features?: RouteFeatureLike[];
}

/** Routes: one LineString per route. */
export function routeFeaturesFromGeoJSON(routes: GeoJSONRoutes | undefined): GeometryFeature[] {
  return (routes?.features ?? [])
    .map((route, index) => toFeature(route.geometry ?? undefined, { route: index }))
    .filter((f): f is GeometryFeature => Boolean(f));
}

/**
 * One feature per incident, Point or LineString as the API returns it. Pass the
 * capped result so `incident` matches the compact `incidents` order.
 */
export function incidentFeatures(response: TrafficResponse | undefined): GeometryFeature[] {
  return (response?.features ?? [])
    .map((incident, index) => toFeature(incident.geometry, { incident: index }))
    .filter((f): f is GeometryFeature => Boolean(f));
}
