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
//   have carried request params, including the API key (#283).

import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import { capPaths, roundPosition } from "./simplify";

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

const isPath = (value: unknown): value is Position[] =>
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
    default:
      return null;
  }
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

// ---------------------------------------------------------------------------
// Point indexes
// ---------------------------------------------------------------------------

const POINT_INDEX_KEYS = new Set(["startPointIndex", "endPointIndex", "pointIndex"]);

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

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

interface RouteFeatureLike {
  geometry?: RawGeometry | null;
  properties?: Record<string, unknown> | null;
}

interface GeoJSONRoutes {
  features?: RouteFeatureLike[];
}

/** Orbis routes (and the route of search along route): one LineString per route. */
export function routeFeaturesFromGeoJSON(routes: GeoJSONRoutes | undefined): GeometryFeature[] {
  return (routes?.features ?? [])
    .map((route, index) => toFeature(route.geometry ?? undefined, { route: index }))
    .filter((f): f is GeometryFeature => Boolean(f));
}

interface LatLon {
  latitude?: number;
  longitude?: number;
}

const toPosition = (p: LatLon): Position | null =>
  typeof p?.longitude === "number" && typeof p?.latitude === "number"
    ? [p.longitude, p.latitude]
    : null;

/** Converts a TomTom Maps point list to GeoJSON positions. */
export function pointsToPositions(points: unknown): Position[] {
  if (!Array.isArray(points)) return [];
  return points.map(toPosition).filter((p): p is Position => p !== null);
}

interface LegacyRoutes {
  routes?: Array<{ legs?: Array<{ points?: unknown }> }>;
}

/**
 * TomTom Maps routes: the legs' point lists joined into one LineString per route.
 * A leg starts where the previous one ended, so that shared point appears once.
 */
export function routeFeaturesFromPoints(response: LegacyRoutes | undefined): GeometryFeature[] {
  return (response?.routes ?? [])
    .map((route, index) => {
      const line: Position[] = [];
      for (const leg of route.legs ?? []) {
        for (const p of pointsToPositions(leg.points)) {
          const prev = line[line.length - 1];
          if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) line.push(p);
        }
      }
      return toFeature({ type: "LineString", coordinates: line }, { route: index });
    })
    .filter((f): f is GeometryFeature => Boolean(f));
}

interface EVLeg {
  summary?: { chargingInformationAtEndOfLeg?: { geometry?: RawGeometry } };
}

/** EV routes: the route lines, then one Point per charging stop, keyed by route and leg. */
export function evRouteFeatures(routes: GeoJSONRoutes | undefined): GeometryFeature[] {
  const stops = (routes?.features ?? []).flatMap((route, routeIndex) => {
    const sections = route.properties?.sections as { leg?: EVLeg[] } | undefined;
    return (sections?.leg ?? []).map((leg, legIndex) =>
      toFeature(leg.summary?.chargingInformationAtEndOfLeg?.geometry, {
        route: routeIndex,
        leg: legIndex,
      })
    );
  });
  return [
    ...routeFeaturesFromGeoJSON(routes),
    ...stops.filter((f): f is GeometryFeature => Boolean(f)),
  ];
}

// ---------------------------------------------------------------------------
// Reachable range
// ---------------------------------------------------------------------------

/** Budget key per SDK budget type: the unit is in the name, as in `budget_min`. */
const BUDGET_KEYS: Record<string, string> = {
  timeMinutes: "budget_min",
  distanceKM: "budget_km",
  spentFuelLiters: "budget_fuel_l",
  spentChargePCT: "budget_charge_pct",
  remainingChargeCPT: "budget_remaining_charge_pct",
};

function budgetKey(budget: unknown): GeometryProperties {
  const { type, value } = (budget ?? {}) as { type?: unknown; value?: unknown };
  if (typeof type !== "string" || typeof value !== "number") return {};
  return { [BUDGET_KEYS[type] ?? `budget_${type}`]: value };
}

/** Orbis reachable range: one Polygon per budget ring. */
export function rangeFeaturesFromGeoJSON(ranges: GeoJSONRoutes | undefined): GeometryFeature[] {
  return (ranges?.features ?? [])
    .map((range, index) =>
      toFeature(range.geometry ?? undefined, {
        range: index,
        ...budgetKey(range.properties?.budget),
      })
    )
    .filter((f): f is GeometryFeature => Boolean(f));
}

export interface LegacyRangeBudget {
  timeBudgetInSec?: number;
  distanceBudgetInMeters?: number;
  energyBudgetInkWh?: number;
  fuelBudgetInLiters?: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** The request budget, in the units the Orbis budget types use. */
function legacyBudgetKey(budget: LegacyRangeBudget): GeometryProperties {
  if (budget.timeBudgetInSec !== undefined) {
    return { budget_min: round2(budget.timeBudgetInSec / 60) };
  }
  if (budget.distanceBudgetInMeters !== undefined) {
    return { budget_km: round2(budget.distanceBudgetInMeters / 1000) };
  }
  if (budget.fuelBudgetInLiters !== undefined) return { budget_fuel_l: budget.fuelBudgetInLiters };
  if (budget.energyBudgetInkWh !== undefined)
    return { budget_energy_kwh: budget.energyBudgetInkWh };
  return {};
}

interface LegacyRange {
  reachableRange?: { boundary?: unknown };
}

/** TomTom Maps reachable range: its boundary point list as one Polygon. */
export function rangeFeaturesFromPoints(
  response: LegacyRange | undefined,
  budget: LegacyRangeBudget
): GeometryFeature[] {
  const ring = pointsToPositions(response?.reachableRange?.boundary);
  if (ring.length < 3) return [];
  const feature = toFeature(
    { type: "Polygon", coordinates: [ring] },
    { range: 0, ...legacyBudgetKey(budget) }
  );
  return feature ? [feature] : [];
}

// ---------------------------------------------------------------------------
// Traffic
// ---------------------------------------------------------------------------

interface Incidents {
  incidents?: Array<{ geometry?: RawGeometry | null }>;
}

/**
 * One feature per incident, Point or LineString as the API returns it. Pass the
 * capped result so `incident` matches the compact `incidents` order.
 */
export function incidentFeatures(response: Incidents | undefined): GeometryFeature[] {
  return (response?.incidents ?? [])
    .map((incident, index) => toFeature(incident.geometry ?? undefined, { incident: index }))
    .filter((f): f is GeometryFeature => Boolean(f));
}

// ---------------------------------------------------------------------------
// Area search
// ---------------------------------------------------------------------------

/** The area search boundary, keyed by its shape: "circle", "polygon" or "boundingBox". */
export function boundaryFeature(
  boundary: { geometry?: RawGeometry; properties?: { geometryType?: unknown } | null } | null
): GeometryFeature[] {
  if (!boundary) return [];
  const shape = boundary.properties?.geometryType;
  const feature = toFeature(boundary.geometry, {
    boundary: typeof shape === "string" ? shape : "polygon",
  });
  return feature ? [feature] : [];
}
