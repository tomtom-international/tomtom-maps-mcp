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
 * `where` — one geographic-scope field with several modes, and the resolver behind it.
 *
 * `within` is an area (names, bounds or polygons), `nearby` a point plus radius,
 * `global` no constraint (*Scope* in CONTEXT.md); `tomtom-discover-places` adds a
 * route mode of its own. A name in `queries` resolves to the AREA it names — a
 * city, district or neighbourhood — from one geocode, whose own ranking decides,
 * and to its outline from one boundary request for all of them, or to its bounding
 * box when it has none; the response names where each query resolved.
 */

import { type BBox, type Place, type Places, polygonFromBBox } from "@tomtom-org/maps-sdk/core";
import * as turf from "@turf/turf";
import type { MultiPolygon, Polygon, Position } from "geojson";
import type { z } from "zod";
import type { knownAreaSchema, NearbyWhere, WithinWhere } from "../../../schemas/shared/where";
import {
  boundaryIdOf,
  fetchBoundaries,
  fuzzySearch,
  geocodeAreas,
  isCountry,
  type LookupOptions,
} from "../../../services/search/searchService";
import { toBBox } from "../../../services/shared/sdkInputs";
import { IncorrectError } from "../../../types/types";
import { failureMessage } from "../../../utils/apiErrorHandler";
import { logger } from "../../../utils/logger";
import { isRings } from "../geometry-response";
import { dedupeBy } from "../in-batches";
import { inNamedArea, isNamed, placeName, rankPlaceCandidates } from "./place-names";

/** An area to search: its bounds, and its polygon when it has one. */
export interface AreaBounds {
  bbox: BBox;
  polygon?: Polygon | MultiPolygon;
  /** The Geometry Data id `polygon` came from, for a named area. */
  boundaryId?: string;
}

/** An area with its polygon. */
type PolygonArea = Required<Pick<AreaBounds, "bbox" | "polygon">>;

/** An area as one polygon: the one drawn, else its bounds. */
export const areaPolygon = ({ bbox, polygon }: AreaBounds): Polygon | MultiPolygon =>
  polygon ?? polygonFromBBox(bbox).geometry;

/** Polygons as one geometry: the only one, else a MultiPolygon of every part. */
export const asOnePolygon = (parts: readonly (Polygon | MultiPolygon)[]): Polygon | MultiPolygon =>
  parts.length === 1
    ? parts[0]
    : {
        type: "MultiPolygon",
        coordinates: parts.flatMap((part) =>
          part.type === "Polygon" ? [part.coordinates] : part.coordinates
        ),
      };

/**
 * A resolved area, and where it came from, for reporting back what was searched.
 * `outlineUnavailable` is why the outline it has could not be fetched, so its
 * bounding box stands in.
 */
type ResolvedArea = AreaBounds & { outlineUnavailable?: string } & (
    | { source: "boundingBox" | "geometry" }
    /** `label` is the GROUNDED match, `query` what was asked for. */
    | { source: "query"; query: string; label: string }
    | { source: "area"; label: string }
  );

/**
 * A named area as a result reports it and `within.areas` takes it back: what a
 * later call needs to search the same area without geocoding its name again.
 */
type KnownArea = Omit<z.infer<typeof knownAreaSchema>, "boundingBox"> & {
  boundingBox: BBox;
};

/** A point bias for `nearby`, with the radius the caller asked for. */
interface ResolvedBias {
  position: Position;
  radiusMeters: number;
  label?: string;
}

/** Whether a `geometries` entry nests its rings as its type requires; the schema checks only the type. */
const isPolygonal = (geometry: {
  type: Polygon["type"] | MultiPolygon["type"];
  coordinates: unknown[];
}): geometry is Polygon | MultiPolygon =>
  geometry.type === "Polygon"
    ? isRings(geometry.coordinates)
    : geometry.coordinates.length > 0 && geometry.coordinates.every(isRings);

/**
 * Resolves a `within` scope to one or more areas.
 *
 * Explicit fields are unioned. A `queries` entry that resolves to nothing is a
 * hard failure rather than a silent widening: "restaurants in Atlantis" returning
 * results from wherever the geocoder guessed is worse than an error.
 *
 * @param options.allowCountry Takes a country too, for a lookup that only needs its box.
 * @param options.boundsOnly Fetches no outline, for a lookup that keeps only the bounds.
 * @throws IncorrectError when no field is given, a geometry is malformed or a query names no area.
 */
export async function resolveWithin(
  where: WithinWhere,
  options: { allowCountry?: boolean; boundsOnly?: boolean } = {}
): Promise<ResolvedArea[]> {
  const areas: ResolvedArea[] = [];

  const boundingBox = toBBox(where.boundingBox);
  if (boundingBox) areas.push({ bbox: boundingBox, source: "boundingBox" });

  for (const [index, geometry] of (where.geometries ?? []).entries()) {
    if (!isPolygonal(geometry)) {
      throw new IncorrectError(
        "A `where.geometries` entry is not a valid GeoJSON geometry. A Polygon's `coordinates` " +
          "is an array of rings, each an array of [longitude, latitude] positions; a " +
          "MultiPolygon's is an array of those.",
        { index, type: geometry.type }
      );
    }
    areas.push({ bbox: turf.bbox(geometry) as BBox, polygon: geometry, source: "geometry" });
  }

  areas.push(...(await resolveAreaQueries(where.queries ?? [], options)));
  const known = where.areas ?? [];
  const { polygons: outlines, unavailable } = await boundariesById(
    options.boundsOnly ? [] : known.map(({ boundaryId }) => boundaryId)
  );
  for (const [index, { name, boundingBox, boundaryId }] of known.entries()) {
    const [west, south, east, north] = boundingBox;
    const polygon = outlines[index];
    areas.push({
      bbox: [west, south, east, north],
      ...(polygon && { polygon, boundaryId }),
      ...(boundaryId && unavailable && { outlineUnavailable: unavailable }),
      label: name,
      source: "area",
    });
  }

  if (areas.length === 0) {
    throw new IncorrectError(
      '`where` with mode "within" needs at least one of: queries, areas, boundingBox, geometries.'
    );
  }
  return areas;
}

/**
 * Geocodes area names, one request each, and fetches their outlines in one more.
 * The first match wins: with no map there is nothing to re-rank by. An area
 * without an outline, or whose outline fetch failed, is searched by its bounds.
 */
async function resolveAreaQueries(
  queries: readonly string[],
  { allowCountry = false, boundsOnly = false }: { allowCountry?: boolean; boundsOnly?: boolean }
): Promise<ResolvedArea[]> {
  if (!queries.length) return [];
  const matches = await Promise.all(
    queries.map(async (query) => {
      const [top] = (await geocodeAreas(query, { limit: 1 })).features;
      if (top && isCountry(top) && !allowCountry) {
        throw new IncorrectError(
          `"${query}" is a country, too large to search as one area. Name a region or city ` +
            "in it instead. tomtom-discover-places also searches a whole country with mode " +
            '"global" and `countries`.',
          { query, countryCode: top.properties.address?.countryCode }
        );
      }
      if (!top?.bbox) {
        throw new IncorrectError(
          "Could not resolve the query to a city, district or neighbourhood. Qualify the name " +
            '("De Jordaan, Amsterdam"), use mode "nearby" for a landmark or venue, or give a ' +
            "boundingBox.",
          { query }
        );
      }
      return { top, bbox: top.bbox };
    })
  );
  const { polygons, unavailable } = await boundariesOf(
    boundsOnly ? [] : matches.map(({ top }) => top)
  );
  return matches.map(({ top, bbox }, index): ResolvedArea => {
    const polygon = polygons[index];
    return {
      bbox,
      ...(polygon && { polygon, boundaryId: boundaryIdOf(top) }),
      ...(boundaryIdOf(top) && unavailable && { outlineUnavailable: unavailable }),
      label: placeName(top) ?? queries[index],
      source: "query",
      query: queries[index],
    };
  });
}

/** Boundary polygons, and why they are missing when the Geometry Data service failed. */
interface Boundaries<T> {
  polygons: T;
  /** Why the fetch failed ("Rate limit exceeded…"), so a missing outline is not read as none. */
  unavailable?: string;
}

/**
 * Each place's boundary polygon, in their order, from one Geometry Data request:
 * undefined for a place without one. A failed fetch says why in `unavailable`
 * (logged with its status by `handleApiError`) rather than failing the call.
 */
export const boundariesOf = (
  places: readonly Place[]
): Promise<Boundaries<(Polygon | MultiPolygon | undefined)[]>> =>
  boundariesById(places.map(boundaryIdOf));

/** {@link boundariesOf} for the boundary ids themselves. */
async function boundariesById(
  ids: readonly (string | undefined)[]
): Promise<Boundaries<(Polygon | MultiPolygon | undefined)[]>> {
  const wanted = [...new Set(ids.filter((id) => id !== undefined))];
  if (!wanted.length) return { polygons: ids.map(() => undefined) };
  try {
    const { features } = await fetchBoundaries(wanted);
    const byId = new Map(features.map((feature) => [String(feature.id), feature.geometry]));
    return { polygons: ids.map((id) => (id === undefined ? undefined : byId.get(id))) };
  } catch (caught) {
    return {
      polygons: ids.map(() => undefined),
      unavailable: failureMessage(caught, "Boundary fetch"),
    };
  }
}

/** The known area `within.areas` takes for a city, district or neighbourhood a lookup returned. */
export const knownAreaOf = (place: Place): KnownArea | undefined => {
  const name = placeName(place);
  if (place.properties.type !== "Geography" || !place.bbox || !name) return undefined;
  const [west, south, east, north] = place.bbox;
  const boundaryId = boundaryIdOf(place);
  return { name, boundingBox: [west, south, east, north], ...(boundaryId && { boundaryId }) };
};

/** Default radius for `nearby` when the caller does not say. */
const DEFAULT_NEARBY_RADIUS_METERS = 1000;

/**
 * Splits "Dam Square, Amsterdam" into the thing being looked for and the place
 * that qualifies it. The tail is what puts the candidates in that place first,
 * so a global index does not answer in the wrong country.
 */
export const splitNamedQuery = (query: string): { subject: string; area?: string } => {
  const parts = query
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return { subject: query.trim() };
  return { subject: parts[0], area: parts.slice(1).join(", ") };
};

/** Where a name lookup looks: a hard bounding box, a point bias with an optional radius, or anywhere. */
export type LookupScope = Omit<LookupOptions, "limit">;

/** How many candidates a name search weighs: enough to report the alternatives too. */
export const NAME_CANDIDATES = 10;

/**
 * Searches for a place NAME: one fuzzy search, which asks the POI index and the
 * geocoder together, ranked by `rankPlaceCandidates`. The whole query goes in,
 * tail and all: the POI index asked for "Sagrada Família" alone answers with
 * churches of that name in Galați and A Coruña.
 *
 * When nothing it returns is called what was asked for, the geocoder is asked for
 * an area of that name too: the fuzzy search answers "De Jordaan, Amsterdam" with
 * ten businesses named after the neighbourhood, and not the neighbourhood.
 */
export async function searchPlaceName(
  query: string,
  scope: LookupScope = {}
): Promise<{ response: Places } & ReturnType<typeof rankPlaceCandidates<Place>>> {
  const { subject, area } = splitNamedQuery(query);
  const response = await fuzzySearch(query, { limit: NAME_CANDIDATES, ...scope });
  const ranking = rankPlaceCandidates(response.features, subject, area);
  if (ranking.matchedByName) return { response, ...ranking };

  const namedArea = await areaNamed(query, subject, area, scope);
  if (!namedArea) return { response, ...ranking };
  // The fuzzy search may hold the same area further down, below a business of its name.
  const features = dedupeBy([namedArea, ...response.features], ({ id }) => String(id)).unique.slice(
    0,
    NAME_CANDIDATES
  );
  return { response: { ...response, features }, ...rankPlaceCandidates(features, subject, area) };
}

/**
 * The area the geocoder finds for `query`, when it is called `subject` and lies in
 * `area`. A failed lookup leaves the fuzzy search's answer standing.
 */
async function areaNamed(
  query: string,
  subject: string,
  area: string | undefined,
  scope: LookupScope
): Promise<Place | undefined> {
  try {
    const [top] = (await geocodeAreas(query, { ...scope, limit: 1 })).features;
    return top && isNamed(top, subject) && inNamedArea(top, area) ? top : undefined;
  } catch (caught) {
    logger.warn({ query, error: failureMessage(caught, "Area lookup") }, "Area lookup failed");
    return undefined;
  }
}

/**
 * Resolves a place NAME to a point, as tomtom-locate-place resolves it. The best
 * candidate is refused when it lies outside the area the query names ("…,
 * Amsterdam") and is not named exactly what was asked for either.
 */
export async function resolvePlaceName(
  query: string
): Promise<{ position: Position; label: string } | undefined> {
  const { area } = splitNamedQuery(query);
  const {
    ranked: [match],
    matchedByName,
  } = await searchPlaceName(query);
  if (!match || (!matchedByName && !inNamedArea(match, area))) return undefined;
  return { position: match.geometry.coordinates, label: placeName(match) ?? query };
}

/**
 * Resolves a `nearby` scope to a bias point.
 *
 * An unresolvable or missing bias is a HARD failure, not an unbiased search: that
 * search answers "within 800m of Dam Square, Amsterdam" with restaurants in
 * Leesburg, Virginia, under the scope that was asked for.
 *
 * @throws IncorrectError when neither `position` nor `query` is given, or the query does not resolve.
 */
export async function resolveNearby(where: NearbyWhere): Promise<ResolvedBias> {
  const radiusMeters = where.radiusMeters ?? DEFAULT_NEARBY_RADIUS_METERS;

  if (where.position) {
    return { position: where.position, radiusMeters };
  }

  if (where.query) {
    const resolved = await resolvePlaceName(where.query);
    if (!resolved) {
      throw new IncorrectError(
        "Could not resolve the query to a point to search around. Give `where.position` as " +
          '[longitude, latitude], or name the area with `where: { mode: "within", queries: [...] }` instead.',
        { query: where.query }
      );
    }
    return { position: resolved.position, radiusMeters, label: resolved.label };
  }

  throw new IncorrectError(
    '`where` with mode "nearby" needs `position` ([longitude, latitude]) or `query` (a place ' +
      'name). For no geographic constraint, use mode "global".'
  );
}

/** The circle a `nearby` search covers, as an area to search. */
export const circleOf = ({ position, radiusMeters }: ResolvedBias): PolygonArea => {
  const polygon = turf.circle(position, radiusMeters, { units: "meters" }).geometry;
  return { bbox: turf.bbox(polygon) as BBox, polygon };
};

/**
 * A nearby radius as a scope states it, saying when it is the default: a model that
 * left `radiusMeters` out read "within 1000 m" as the 500 m it had been asked for.
 */
const radiusOf = (meters: number): string =>
  meters === DEFAULT_NEARBY_RADIUS_METERS
    ? `${meters}m (the default \`radiusMeters\`)`
    : `${meters}m`;

/** What a `nearby` search was centred on, for reporting alongside results. */
export const describeBias = ({ position, radiusMeters, label }: ResolvedBias): string =>
  `within ${radiusOf(radiusMeters)} of ${label ?? position.join(", ")}`;

/** What was actually searched, for reporting alongside results. */
export const describeAreas = (areas: readonly ResolvedArea[]): string =>
  areas
    .map((area) => {
      if (!("label" in area)) return area.polygon ? "geometry polygon" : "boundingBox";
      if (area.polygon) return area.label;
      return area.outlineUnavailable
        ? `${area.label} (bounding box: its outline could not be fetched, ${area.outlineUnavailable})`
        : `${area.label} (bounding box)`;
    })
    .join("; ");

/**
 * Where each named area resolved. A name several places share resolves to one of
 * them ("Westminster" to Westminster, CO), and this is how the model can tell.
 * `area` is what a later call passes in `within.areas` to skip the geocode.
 */
export const resolvedAreasOf = (
  areas: readonly ResolvedArea[]
): { query: string; matched: string; area: KnownArea }[] =>
  areas.flatMap((area) =>
    area.source === "query"
      ? [
          {
            query: area.query,
            matched: area.label,
            area: {
              name: area.label,
              boundingBox: area.bbox,
              ...(area.boundaryId && { boundaryId: area.boundaryId }),
            },
          },
        ]
      : []
  );
