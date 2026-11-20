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
 * city, district or neighbourhood — from its geocode, whose own ranking decides,
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
import {
  inNamedArea,
  isCountryName,
  isNamed,
  lostAreaWords,
  namedMatches,
  placeName,
  rankPlaceCandidates,
  startsWithName,
} from "./place-names";

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
 * Geocodes area names ({@link geocodeAreaName}), and fetches their outlines in one
 * more request. The first match wins: with no map there is nothing to re-rank by. An area
 * without an outline, or whose outline fetch failed, is searched by its bounds.
 */
async function resolveAreaQueries(
  queries: readonly string[],
  { allowCountry = false, boundsOnly = false }: { allowCountry?: boolean; boundsOnly?: boolean }
): Promise<ResolvedArea[]> {
  if (!queries.length) return [];
  const matches = await Promise.all(
    queries.map(async (query) => {
      const [top] = await geocodeAreaName(query);
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

/**
 * The area the geocoder ranks first for a name, or, when it kept only the name's
 * generic words, for the words it lost ({@link lostAreaWords}), if any area
 * carries them.
 */
async function geocodeAreaName(query: string): Promise<Place[]> {
  const { features } = await geocodeAreas(query, { limit: 1 });
  const lost = lostAreaWords(query, features);
  if (!lost) return features;
  const named = (await geocodeAreas(lost.join(" "), { limit: 1 })).features.filter((area) =>
    inNamedArea(area, lost.join(", "))
  );
  return named.length ? named : features;
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
 * (logged by `upstreamCall`) rather than failing the call.
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
      unavailable: failureMessage(caught),
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

/** A name's candidates, ranked, with the response they came in. */
type NameMatch = { response: Places } & ReturnType<typeof rankPlaceCandidates<Place>>;

/**
 * Searches for a place NAME, in the order the agent toolkit's `locatePlace` does,
 * one lookup at a time, so most names cost one request:
 *
 * 1. A country's name goes to the geocoder's areas first, which list the country
 *    the search does not ("Malta"), as the answer when they rank it first.
 * 2. One fuzzy search over the POI index and the geocoder together, ranked by
 *    `rankPlaceCandidates`; its first, when called what was asked ("Brooklyn",
 *    "Colosseum") and no street, which may share the name of the area around it.
 *    The whole query goes in, tail and all: the POI index asked for
 *    "Sagrada Família" alone answers with churches of that name elsewhere.
 * 3. Else the geocoder's areas: its first, when called what was asked, is the
 *    answer ("De Jordaan, Amsterdam"). Only its first: an exact name proves
 *    nothing lower down, where it is Frankfurt (Oder). Else a street called what
 *    was asked ("Leidseplein").
 * 4. Else the area called what was asked where most of what the search found
 *    lies: around its first, as a business named after its neighbourhood ("Jordaan
 *    Oproer") is, or more of it than around its first ("Montmartre" finds a town
 *    in Saskatchewan first, and then Paris).
 * 5. Else the first area called what was asked, when the search's first is an
 *    area that only holds the name: "Le Marais" finds Drouvin-le-Marais first.
 *    A landmark that holds it stands: "Templo de la Sagrada Familia".
 */
export async function searchPlaceName(query: string, scope: LookupScope = {}): Promise<NameMatch> {
  const { subject, area } = splitNamedQuery(query);
  const lookUpAreas = () => areasOrNone(query, { ...scope, limit: NAME_CANDIDATES });
  const countryAreas = isCountryName(subject) ? await lookUpAreas() : undefined;
  const country = countryAreas && namedFirst(countryAreas, subject, area);
  if (country && isCountry(country.ranked[0])) return country;

  const response = await fuzzySearch(query, { limit: NAME_CANDIDATES, ...scope });
  const ranking = rankPlaceCandidates(response.features, subject, area);
  const [first] = ranking.ranked;
  const searched = { response, ...ranking };
  if (first && ranking.matchedByName && first.properties.type !== "Street") return searched;

  const areas = countryAreas ?? (await lookUpAreas());
  const named = areas && namedFirst(areas, subject, area);
  if (named) return named;
  if (!first)
    return areas
      ? { response: areas, ...rankPlaceCandidates(areas.features, subject, area) }
      : searched;
  if (ranking.matchedByName) return searched;
  return withAreaHolder(response, first, areas, subject, area) ?? searched;
}

/**
 * The search's candidates with an area called `subject` first: the one holding
 * most of what the search found, or else, when the search's first is an area
 * that only holds the name, the first of them. Otherwise none.
 */
function withAreaHolder(
  response: Places,
  first: Place,
  areas: Places | undefined,
  subject: string,
  area: string | undefined
): NameMatch | undefined {
  const asked = namedMatches(areas?.features ?? [], subject, area);
  const holder =
    areaHoldingMost(asked, response.features, first) ??
    (first.properties.type !== "Geography" || startsWithName(first, subject)
      ? undefined
      : asked[0]);
  if (!holder) return undefined;
  // The fuzzy search may hold the same area further down, below a business of its name.
  const features = dedupeBy([holder, ...response.features], ({ id }) => String(id)).unique.slice(
    0,
    NAME_CANDIDATES
  );
  return { response: { ...response, features }, ...rankPlaceCandidates(features, subject, area) };
}

/**
 * The geocoder's areas, ranked, when its first is called `subject` in the named
 * area; the one named with the article asked for first ("El Salvador", should
 * the geocoder rank Salvador above it).
 */
function namedFirst(
  areas: Places,
  subject: string,
  area: string | undefined
): NameMatch | undefined {
  const [top] = areas.features;
  if (!top || !isNamed(top, subject) || !inNamedArea(top, area)) return undefined;
  const [asked] = namedMatches(areas.features, subject, area);
  const features = [asked, ...areas.features.filter((feature) => feature !== asked)];
  return { response: { ...areas, features }, ...rankPlaceCandidates(features, subject, area) };
}

/**
 * Of `areas`, the one holding most of `found`: one that holds `first`, or more of
 * `found` than the bounds of `first` (a point counts as one).
 */
function areaHoldingMost(
  areas: readonly Place[],
  found: readonly Place[],
  first: Place
): Place | undefined {
  const holds = (bbox: BBox, place: Place) =>
    turf.booleanPointInPolygon(place.geometry.coordinates, turf.bboxPolygon(bbox));
  const share = (bbox: BBox) => found.filter((place) => holds(bbox, place)).length;
  const firstShare = first.bbox ? share(first.bbox) : 1;
  return areas
    .flatMap((area) => (area.bbox ? [{ area, bbox: area.bbox }] : []))
    .map(({ area, bbox }) => ({ area, share: share(bbox), holdsFirst: holds(bbox, first) }))
    .filter(({ share, holdsFirst }) => holdsFirst || share > firstShare)
    .sort((left, right) => right.share - left.share)[0]?.area;
}

/** The geocoder's areas for `query`, or none when the lookup failed, leaving the fuzzy search to answer. */
async function areasOrNone(query: string, options: LookupOptions): Promise<Places | undefined> {
  try {
    return await geocodeAreas(query, options);
  } catch (caught) {
    logger.warn({ query, error: failureMessage(caught) }, "Area lookup failed");
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
