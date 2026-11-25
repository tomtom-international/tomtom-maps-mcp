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
 * city, district or neighbourhood — from its geocode: the area called that, else the
 * geocode's first, and to its outline from one boundary request for all of them, or to its bounding
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
  geocodeAddress,
  geocodeAreas,
  isCountry,
  type LookupOptions,
} from "../../../services/search/searchService";
import { toBBox } from "../../../services/shared/sdkInputs";
import { IncorrectError } from "../../../types/types";
import { failureMessage } from "../../../utils/apiErrorHandler";
import { logger } from "../../../utils/logger";
import { isPolygons, isRings } from "../geometry-response";
import { dedupeBy } from "../in-batches";
import {
  currentCountryName,
  holdsName,
  holdsPoint,
  inNamedArea,
  isCountryName,
  isNamed,
  lostAreaWords,
  namedMatches,
  nameMatchOf,
  placeName,
  rankPlaceCandidates,
  startsWithName,
} from "./place-names";

/** An area to search: its bounds, and its polygon when it has one. */
export interface AreaBounds {
  bbox: BBox;
  polygon?: Polygon | MultiPolygon;
  /** The named area's Geometry Data id, kept when its outline fetch failed, to fetch it again. */
  boundaryId?: string;
}

/** An area with its polygon. */
type PolygonArea = Required<Pick<AreaBounds, "bbox" | "polygon">>;

export const polygonArea = (polygon: Polygon | MultiPolygon): PolygonArea => ({
  bbox: turf.bbox(polygon) as BBox,
  polygon,
});

/**
 * An area with its outline, if it has one. `outlineUnavailable` is why the outline
 * it has could not be fetched, so its bounding box stands in.
 */
type OutlinedArea = AreaBounds & { outlineUnavailable?: string };

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

/** A resolved area, and where it came from, for reporting back what was searched. */
type ResolvedArea = OutlinedArea &
  (
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
const isPolygonal = (
  geometry: NonNullable<WithinWhere["geometries"]>[number]
): geometry is Polygon | MultiPolygon =>
  geometry.type === "Polygon" ? isRings(geometry.coordinates) : isPolygons(geometry.coordinates);

/** What a `within` lookup needs of the areas it resolves. */
interface WithinOptions {
  /** Takes a country too, for a lookup that only needs its box. */
  allowCountry?: boolean;
  /** Fetches no outline, for a lookup that keeps only the bounds. */
  boundsOnly?: boolean;
}

/**
 * Resolves a `within` scope to one or more areas.
 *
 * Explicit fields are unioned. A `queries` entry that resolves to nothing is a
 * hard failure rather than a silent widening: "restaurants in Atlantis" returning
 * results from wherever the geocoder guessed is worse than an error.
 *
 * @throws IncorrectError when no field is given, a geometry is malformed or a query names no area.
 */
export async function resolveWithin(
  where: WithinWhere,
  options: WithinOptions = {}
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
    areas.push({ ...polygonArea(geometry), source: "geometry" });
  }

  areas.push(...(await resolveAreaQueries(where.queries ?? [], options)));
  const known = where.areas ?? [];
  const knownAreas = await withOutlines(
    known.map(({ boundingBox: [west, south, east, north], boundaryId }) => ({
      bbox: [west, south, east, north],
      boundaryId,
    })),
    options.boundsOnly
  );
  for (const [index, { name }] of known.entries()) {
    areas.push({ ...knownAreas[index], label: name, source: "area" });
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
 * more request. An area without an outline, or whose outline fetch failed, is
 * searched by its bounds.
 */
async function resolveAreaQueries(
  queries: readonly string[],
  { allowCountry = false, boundsOnly = false }: WithinOptions
): Promise<ResolvedArea[]> {
  if (!queries.length) return [];
  const matches = await Promise.all(
    [...new Set(queries)].map(async (query) => {
      const options = { limit: NAME_CANDIDATES };
      const areas = await areasOfLostWords(query, await geocodeAreas(query, options), (words) =>
        geocodeAreas(words, options)
      );
      const found = areasCalled(areas.features, query);
      const [top] = found;
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
      return found.flatMap((place) => (place.bbox ? [{ query, place, bbox: place.bbox }] : []));
    })
  );
  const flat = matches.flat();
  const outlined = await withOutlines(
    flat.map(({ place, bbox }) => ({ bbox, boundaryId: boundaryIdOf(place) })),
    boundsOnly
  );
  return flat.map(
    ({ query, place }, index): ResolvedArea => ({
      ...outlined[index],
      label: placeName(place) ?? query,
      source: "query",
      query,
    })
  );
}

/** Each area with its outline, from one Geometry Data request unless `boundsOnly`. */
async function withOutlines(
  areas: readonly Pick<AreaBounds, "bbox" | "boundaryId">[],
  boundsOnly = false
): Promise<OutlinedArea[]> {
  const { polygons, unavailable } = await boundariesById(
    boundsOnly ? [] : areas.map(({ boundaryId }) => boundaryId)
  );
  return areas.map(({ bbox, boundaryId }, index) => {
    const polygon = polygons[index];
    return {
      bbox,
      ...(polygon && { polygon }),
      ...(boundaryId && { boundaryId }),
      ...(boundaryId && unavailable && { outlineUnavailable: unavailable }),
    };
  });
}

/**
 * The geocoder's areas `found` for a name, or, when their first kept only the name's
 * generic words, the areas of the words it lost ({@link lostAreaWords}) that carry
 * them, if any do: "Utrecht city centre" is Utrecht, not Sun City Center, FL.
 */
async function areasOfLostWords(
  query: string,
  found: Places,
  lookUp: (words: string) => Promise<Places | undefined>
): Promise<Places> {
  const lost = lostAreaWords(query, found.features.slice(0, 1));
  if (!lost) return found;
  const retried = await lookUp(lost.join(" "));
  const named = retried?.features.filter((area) => inNamedArea(area, lost.join(", "))) ?? [];
  return retried && named.length ? { ...retried, features: named } : found;
}

/**
 * Of an area name's geocoded areas, the one called that, in the area named: "Sant
 * Antoni, Barcelona" is the neighbourhood the geocoder ranks below Sant Antoni de
 * Vilamajor, a town in the province of Barcelona. Else, of those whose names hold
 * it, the ones in the town holding most of them, one in the area named first: the
 * geocoder knows Barcelona's Eixample only by its neighbourhoods. Else the first.
 */
const areasCalled = (features: readonly Place[], query: string): Place[] => {
  const { subject, area } = splitNamedQuery(query);
  const [named] = namedMatches(features, subject, area);
  if (named) return [named];
  const holders = features.filter((feature) => holdsName(feature, subject));
  const town = (place: Place) => place.properties.address?.municipality ?? place;
  const rank = (place: Place) =>
    holders.filter((holder) => town(holder) === town(place)).length +
    (inNamedArea(place, area) ? holders.length : 0);
  const best = holders.reduce<Place | undefined>(
    (top, place) => (!top || rank(place) > rank(top) ? place : top),
    undefined
  );
  return best ? holders.filter((place) => town(place) === town(best)) : features.slice(0, 1);
};

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
  return knownArea(name, place.bbox, boundaryIdOf(place));
};

const knownArea = (name: string, boundingBox: BBox, boundaryId?: string): KnownArea => ({
  name,
  boundingBox,
  ...(boundaryId && { boundaryId }),
});

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
  return parts.length < 2
    ? { subject: parts[0] ?? "" }
    : { subject: parts[0], area: parts.slice(1).join(", ") };
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
 *    the search does not ("Malta"), as the answer when their first is named so and
 *    they hold the country.
 * 2. One fuzzy search over the POI index and the geocoder together, ranked by
 *    `rankPlaceCandidates`; its first, when named exactly what was asked, in the
 *    area named ("Brooklyn", "Colosseum"), and no street, which may share the name
 *    of the area around it.
 *    The whole query goes in, tail and all: the POI index asked for
 *    "Sagrada Família" alone answers with churches of that name elsewhere.
 * 3. Else the geocoder's areas: its first, when called what was asked, is the
 *    answer ("De Jordaan, Amsterdam"). Only its first: an exact name proves
 *    nothing lower down, where it is Frankfurt (Oder). Else the search's first
 *    when called what was asked, abbreviated or not ("Leidseplein", "Oxford St").
 * 4. Else the area called what was asked where most of what the search found
 *    lies: around its first, as a business named after its neighbourhood ("Jordaan
 *    Oproer") is, or more of it than around its first ("Montmartre" finds a town
 *    in Saskatchewan first, and then Paris).
 * 5. Else the first area called what was asked, when the search's first is an
 *    area that only holds the name: "Le Marais" finds Drouvin-le-Marais first.
 *    A landmark that holds it stands: "Templo de la Sagrada Familia".
 *
 * A country named as it no longer is goes to the geocoder by its current name:
 * "Turkey" as Türkiye. An area named as no address writes it ("Stephansplatz,
 * Vienna", where addresses say Wien) is looked up by its name, and a place inside
 * its bounds is in it. When nothing found is called what was asked, a street or
 * square called that is ({@link streetCalled}).
 */
export async function searchPlaceName(query: string, scope: LookupScope = {}): Promise<NameMatch> {
  const { subject, area } = splitNamedQuery(query);
  const options = { ...scope, limit: NAME_CANDIDATES };
  // One lookup at most, though a failed one leaves no areas.
  const lookUpAreas = once(() => areasOrNone(query, options));
  const country = isCountryName(subject)
    ? await countryCalled(subject, area, options, lookUpAreas)
    : undefined;
  if (country) return country;

  const response = await fuzzySearch(query, options);
  const ranking = rankPlaceCandidates(response.features, subject, area);
  const [first] = ranking.ranked;
  const searched = { response, ...ranking };
  if (settlesAlone(first, subject, area)) return searched;
  const areas = await lookUpAreas();
  const named = areas && namedFirst(areas, subject, area);
  if (named) return named;

  const lookUpBounds = once(() => (area ? areaBounds(area, options) : Promise.resolve([])));
  const boundsFor = async (candidates: readonly Place[]): Promise<BBox[]> =>
    candidates.some((place) => isNamed(place, subject) && !inNamedArea(place, area))
      ? lookUpBounds()
      : [];
  const bounds = ranking.matchedByName
    ? []
    : await boundsFor([...response.features, ...(areas?.features.slice(0, 1) ?? [])]);
  const inBounds = withinBounds(response, areas, subject, area, bounds);
  if (inBounds) return inBounds;
  if (!first) {
    if (!areas) return searched;
    const named = await areasOfLostWords(query, areas, (words) => areasOrNone(words, options));
    return { response: named, ...rankPlaceCandidates(named.features, subject, area, bounds) };
  }
  if (ranking.matchedByName) return searched;
  return (
    (await streetCalled(subject, area, options, boundsFor)) ??
    withAreaHolder(searched, first, areas?.features ?? [], subject, area, bounds) ??
    searched
  );
}

/** `make`'s answer, asked for on the first call only. */
const once = <T>(make: () => Promise<T>): (() => Promise<T>) => {
  let made: Promise<T> | undefined;
  return () => {
    made ??= make();
    return made;
  };
};

/** A country named by its English name, or a former one, as the geocoder's areas list it. Otherwise none. */
async function countryCalled(
  subject: string,
  area: string | undefined,
  options: LookupOptions,
  lookUpAreas: () => Promise<Places | undefined>
): Promise<NameMatch | undefined> {
  const country = currentCountryName(subject);
  const areas = await (country === subject ? lookUpAreas() : areasOrNone(country, options));
  const named = areas && namedFirst(areas, country, area);
  return named && isCountry(named.ranked[0]) ? named : undefined;
}

/**
 * The search's first, or else the geocoder's first area, called what was asked and
 * inside `bounds`, those of the area named; else the search's first called that,
 * abbreviated or not. Otherwise none.
 */
function withinBounds(
  response: Places,
  areas: Places | undefined,
  subject: string,
  area: string | undefined,
  bounds: readonly BBox[]
): NameMatch | undefined {
  if (!bounds.length) return undefined;
  const ranking = rankPlaceCandidates(response.features, subject, area, bounds);
  const searched = { response, ...ranking };
  if (settlesAlone(ranking.ranked[0], subject, area, bounds)) return searched;
  return (
    (areas && namedFirst(areas, subject, area, bounds)) ??
    (ranking.matchedByName ? searched : undefined)
  );
}

/** The bounds of the places called `area`, for an area named as no address writes it. */
async function areaBounds(area: string, options: LookupOptions): Promise<BBox[]> {
  const { subject, area: within } = splitNamedQuery(area);
  const areas = await areasOrNone(area, options);
  return namedMatches(areas?.features ?? [], subject, within).flatMap(({ bbox }) =>
    bbox ? [bbox] : []
  );
}

/**
 * The street or square called what was asked, in the area named, when the search
 * found nothing called that: the geocoder knows "Marienplatz, Munich", whose POIs
 * are called "Marienplatz Munich" across Germany. A name ending in "Square" is
 * looked for by its local name too: "Dam Square, Amsterdam" is Dam. Otherwise none.
 */
async function streetCalled(
  subject: string,
  area: string | undefined,
  options: LookupOptions,
  boundsFor: (candidates: readonly Place[]) => Promise<BBox[]>
): Promise<NameMatch | undefined> {
  if (!area) return undefined;
  for (const name of new Set([subject, subject.replace(/\s+square$/i, "")])) {
    const response = await addressesOrNone(`${name}, ${area}`, options);
    if (!response) return undefined;
    const bounds = await boundsFor(response.features);
    const ranking = rankPlaceCandidates(response.features, name, area, bounds);
    const [first] = ranking.ranked;
    if (
      first?.properties.type === "Street" &&
      isNamed(first, name) &&
      inNamedArea(first, area, bounds)
    )
      return { response, ...ranking };
  }
  return undefined;
}

/**
 * The search's ranked candidates with one of `asked`, the areas called `subject`, first: the one
 * holding most of what the search found, or else, when the search's first is an area
 * that only holds the name, the first of them. Otherwise none.
 */
function withAreaHolder(
  { response, ranked }: NameMatch,
  first: Place,
  areas: readonly Place[],
  subject: string,
  area: string | undefined,
  bounds: readonly BBox[]
): NameMatch | undefined {
  const asked = namedMatches(areas, subject, area, bounds);
  // Areas the name begins, not only those called it: unqualified, "Frankfurt" is Frankfurt
  // am Main, which holds most of what the search found, not the hamlet called exactly so.
  const begun = areas.filter(
    (place) =>
      !asked.includes(place) && startsWithName(place, subject) && inNamedArea(place, area, bounds)
  );
  const holder =
    areaHoldingMost([...asked, ...begun], response.features, first) ??
    (first.properties.type !== "Geography" || startsWithName(first, subject)
      ? undefined
      : asked[0]);
  if (!holder) return undefined;
  // The fuzzy search may hold the same area further down, below a business of its name.
  const features = dedupeBy([holder, ...ranked], ({ id }) => id).unique.slice(0, NAME_CANDIDATES);
  return {
    response: { ...response, features },
    ranked: features,
    ...nameMatchOf(features, subject),
  };
}

/**
 * Whether the search's first settles a name alone: named exactly that, in the
 * area named, and no street. "York" is not Yorkshire, nor a Le Marais in
 * Brussels the one asked for in Paris.
 */
function settlesAlone(
  first: Place | undefined,
  subject: string,
  area: string | undefined,
  bounds: readonly BBox[] = []
) {
  return (
    !!first &&
    first.properties.type !== "Street" &&
    isNamed(first, subject) &&
    inNamedArea(first, area, bounds)
  );
}

/**
 * The geocoder's areas, ranked, when its first is called `subject` in the named
 * area; the one named with the article asked for first ("El Salvador", should
 * the geocoder rank Salvador above it).
 */
function namedFirst(
  areas: Places,
  subject: string,
  area: string | undefined,
  bounds: readonly BBox[] = []
): NameMatch | undefined {
  const [top] = areas.features;
  if (!top || !isNamed(top, subject) || !inNamedArea(top, area, bounds)) return undefined;
  const [asked] = namedMatches(areas.features, subject, area, bounds);
  const features = [asked, ...areas.features.filter((feature) => feature !== asked)];
  return {
    response: { ...areas, features },
    ...rankPlaceCandidates(features, subject, area, bounds),
  };
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
  const share = (bbox: BBox) => found.filter((place) => holdsPoint(bbox, place)).length;
  const firstShare = first.bbox ? share(first.bbox) : 1;
  return areas
    .flatMap((area) =>
      area.bbox ? [{ area, share: share(area.bbox), holdsFirst: holdsPoint(area.bbox, first) }] : []
    )
    .filter(({ share, holdsFirst }) => holdsFirst || share > firstShare)
    .sort((left, right) => right.share - left.share)[0]?.area;
}

/** A geocoder lookup that answers none when it failed, leaving the fuzzy search to answer. */
const orNone =
  (lookup: typeof geocodeAreas, what: string) =>
  async (query: string, options: LookupOptions): Promise<Places | undefined> => {
    try {
      return await lookup(query, options);
    } catch (caught) {
      logger.warn({ query, error: failureMessage(caught) }, `${what} failed`);
      return undefined;
    }
  };

/** The geocoder's areas for `query`, or none when the lookup failed. */
const areasOrNone = orNone(geocodeAreas, "Area lookup");

/** The geocoder's places of any kind for `query`, or none when the lookup failed. */
const addressesOrNone = orNone(geocodeAddress, "Address lookup");

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
  const radiusMeters = nearbyRadius(where);

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
export const circleOf = ({ position, radiusMeters }: ResolvedBias): PolygonArea =>
  polygonArea(turf.circle(position, radiusMeters, { units: "meters" }).geometry);

/** Sides of each circle searched: under the API's 50 vertices, and drawn round the circle, not inside it. */
const CIRCLE_STEPS = 32;

/** The circles a `nearby` search around several points covers. */
export const circlesAround = (positions: readonly Position[], radiusMeters: number): Polygon[] =>
  positions.map(
    (position) =>
      turf.circle(position, radiusMeters / Math.cos(Math.PI / CIRCLE_STEPS), {
        units: "meters",
        steps: CIRCLE_STEPS,
      }).geometry
  );

/** A `nearby` search's radius, or the default when it gives none. */
export const nearbyRadius = (where: Pick<NearbyWhere, "radiusMeters">): number =>
  where.radiusMeters ?? DEFAULT_NEARBY_RADIUS_METERS;

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

/** What a `nearby` search around several points covered, for reporting alongside results. */
export const describePositions = (count: number, radiusMeters: number): string =>
  `within ${radiusOf(radiusMeters)} of each of the ${count} positions`;

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
            area: knownArea(area.label, area.bbox, area.boundaryId),
          },
        ]
      : []
  );

/** What a `within` search covered: its areas, and where each named one resolved. */
export const describeWithin = (areas: readonly ResolvedArea[]) => {
  const resolvedAreas = resolvedAreasOf(areas);
  return { scope: describeAreas(areas), ...(resolvedAreas.length && { resolvedAreas }) };
};
