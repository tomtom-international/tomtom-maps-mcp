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
 * `tomtom-discover-places` — the places search.
 *
 * Two resolvers do the joining a model would otherwise do in extra calls
 * (`shared/inputs/`): `resolvePoiCategories` accepts natural language, and
 * `resolveWithin` and `resolveNearby` turn an area or landmark NAME into its
 * outline, or bounding box when it has none, or its point. Which search
 * endpoint answers is this module's dispatch on `where.mode`.
 */

import type { Place, Places, POICategory } from "@tomtom-org/maps-sdk/core";
import type { AlongRoutePlaceProps } from "@tomtom-org/maps-sdk/services";
import * as turf from "@turf/turf";
import type { MultiPolygon, Polygon, Position } from "geojson";
import type {
  AlongRoute,
  AreaSearch,
  SearchBoundary,
} from "../../apps/map/places-and-routes/mapContent";
import {
  type DiscoverPlacesParams,
  type DiscoverWhere,
  MAX_ALONG_ROUTE_RESULTS,
  MAX_LIMIT,
  type MaxDetourWhere,
} from "../../schemas/search/discoverPlacesSchema";
import { type AlongRouteWhere, DEFAULT_CORRIDOR_METERS } from "../../schemas/shared/alongRoute";
import {
  DEFAULT_SEARCH_LIMIT,
  fuzzySearch,
  type PlacesSearchOptions,
  searchAlongRoute,
  searchInAreas,
} from "../../services/search/searchService";
import { toSupportedLanguage } from "../../services/shared/sdkInputs";
import { IncorrectError } from "../../types/types";
import { logger } from "../../utils/logger";
import { type Matched, placeAlongRoute, searchCorridor } from "../shared/corridor";
import { type GeometryFeature, toFeature } from "../shared/geometry-response";
import { dedupeBy } from "../shared/in-batches";
import { planStretchedDrive } from "../shared/inputs/location-input";
import { resolvePoiCategories } from "../shared/inputs/resolve-poi-categories";
import {
  areaPolygon,
  asOnePolygon,
  circleOf,
  circlesAround,
  describeBias,
  describePositions,
  describeWithin,
  nearbyRadius,
  resolveNearby,
  resolveWithin,
} from "../shared/inputs/resolve-where";
import { describeStretches } from "../shared/inputs/route-stretch";
import {
  buildErrorResponse,
  buildToolResponse,
  countInto,
  trimSearchResponse,
  withoutOpeningHours,
} from "../shared/response-trimmer";
import type { ToolResponse } from "../shared/tool-entry";

/** The search inputs a scope's search takes, with `limit` defaulted. */
type ScopeOptions = PlacesSearchOptions & { limit: number };

/**
 * What a scoped search with no subject browses: the commonest kinds of place,
 * as many as one search takes. The API has no "everything": an empty query
 * needs a category.
 */
const BROWSE_CATEGORIES: POICategory[] = [
  "RESTAURANT",
  "CAFE_PUB",
  "SHOP_OR_STORE",
  "HOTEL_OR_MOTEL",
  "TOURIST_ATTRACTION",
  "MUSEUM",
  "PUBLIC_TRANSPORT_STOP",
  "PARKING_GARAGE",
  "BANK",
  "NIGHTLIFE",
];

/** What a search with charger filters and no other subject finds. */
const CHARGER_CATEGORIES: POICategory[] = ["CHARGING_LOCATION"];

/**
 * How many results a `within` search asks for before ranking them centre-first:
 * in an area the API's order says nothing about where a place is, so the first
 * `limit` it returns can all sit on one edge.
 */
const CENTRE_RANKING_POOL = 50;

/** The result of one scope's search, how to report what it covered, and what the app draws. */
interface ScopedSearch {
  result: Places;
  searched: Record<string, unknown>;
  appData?: AreaSearch | AlongRoute;
  /** Whether every place the scope matched came back, where the result count alone cannot say. */
  complete?: boolean;
  /** How many places the scope's searches found before `limit` cut them; at least that many when not `exact`. */
  matched?: Matched;
  /** For places in driving order: how long the drive is, and how far along it the last one lies. */
  drivingOrder?: DrivingOrder;
  /** How to find more when a higher `limit` returns no more, the scope's searches already returning their most. */
  beyondLimit?: string;
}

interface DrivingOrder {
  driveMeters: number;
  lastMeters?: number;
}

const isSearchBoundary = (feature: GeometryFeature): feature is GeometryFeature & SearchBoundary =>
  feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon";

/**
 * The places with the searched areas as the one outline the app draws, rounded and
 * capped to the vertex budget as a `geometry` response is: a boundary can carry far
 * more vertices than an outline needs.
 */
const withSearchBoundary = (
  result: Places,
  areas: readonly (Polygon | MultiPolygon)[]
): AreaSearch => {
  const feature = toFeature(asOnePolygon(areas), {});
  const boundary = feature && isSearchBoundary(feature) ? feature : undefined;
  return { ...withoutOpeningHours(result), ...(boundary && { _searchBoundary: boundary }) };
};

/** How far `place` lies from each of `points`, in metres, and which of them is nearest. */
const distancesFrom = (points: readonly Position[], place: Place) => {
  const meters = points.map((point) =>
    turf.distance(point, place.geometry.coordinates, { units: "meters" })
  );
  return { meters, nearest: meters.indexOf(Math.min(...meters)) };
};

/**
 * The `limit` places nearest the centres of `areas`, taking each area's nearest
 * in turn so that one large area cannot crowd out the others.
 */
function centreFirst(
  places: Places,
  areas: readonly (Polygon | MultiPolygon)[],
  limit: number
): Places {
  const centres = areas.map((area) => turf.centerOfMass(area).geometry.coordinates);
  const byArea: { place: Places["features"][number]; meters: number }[][] = centres.map(() => []);
  for (const place of places.features) {
    const { meters, nearest } = distancesFrom(centres, place);
    byArea[nearest].push({ place, meters: meters[nearest] });
  }
  for (const ranked of byArea) ranked.sort((a, b) => a.meters - b.meters);

  const features: Places["features"] = [];
  for (
    let rank = 0;
    features.length < limit && byArea.some((ranked) => rank < ranked.length);
    rank++
  ) {
    for (const ranked of byArea) if (rank < ranked.length) features.push(ranked[rank].place);
  }
  return { ...places, features: features.slice(0, limit) };
}

/**
 * The places inside `areas`. The Search API holds a search to an outline only
 * roughly: within Berlin it returned a café in Falkensee, 500 m outside.
 */
const insideAreas = (places: Places, areas: readonly (Polygon | MultiPolygon)[]): Places => ({
  ...places,
  features: places.features.filter(({ geometry }) =>
    areas.some((area) => turf.booleanPointInPolygon(geometry.coordinates, area))
  ),
});

/**
 * The places inside `geometries`, nearest the centre of each first. A search that
 * returns its most can leave a sparse area's places out, crowded out by its
 * neighbours', so the areas it found nothing in are searched again on their own.
 */
async function searchAreas(
  query: string,
  geometries: readonly (Polygon | MultiPolygon)[],
  options: ScopeOptions
): Promise<Omit<ScopedSearch, "searched">> {
  const { limit } = options;
  const poolLimit = Math.max(limit, CENTRE_RANKING_POOL);
  const search = async (areas: readonly (Polygon | MultiPolygon)[]) => {
    const found = await searchInAreas(query, [...areas], { ...options, limit: poolLimit });
    return { pool: insideAreas(found, areas), exact: found.features.length < poolLimit };
  };
  const first = await search(geometries);
  const empty = first.exact
    ? []
    : geometries.filter((area) => !insideAreas(first.pool, [area]).features.length);
  const second = empty.length ? await search(empty) : undefined;
  const pool: Places = {
    ...first.pool,
    features: dedupeBy([...first.pool.features, ...(second?.pool.features ?? [])], ({ id }) => id)
      .unique,
  };
  const result = centreFirst(pool, geometries, limit);
  const { exact } = first;
  return {
    result,
    complete: exact && pool.features.length <= limit,
    matched: { count: pool.features.length, exact },
    ...(!exact && poolLimit >= MAX_LIMIT && { beyondLimit: ONE_SEARCH_CAP }),
    appData: withSearchBoundary(result, geometries),
  };
}

/**
 * The places within `radiusMeters` of each position, in one search, each tagged with
 * the index of the position it is nearest and its metres from it: by default as
 * `nearPosition` and `distance`.
 */
async function searchAround(
  query: string,
  positions: readonly Position[],
  radiusMeters: number,
  options: ScopeOptions,
  tag = (nearPosition: number, distance: number): object => ({ nearPosition, distance })
): Promise<Omit<ScopedSearch, "searched">> {
  const found = await searchAreas(query, circlesAround(positions, radiusMeters), options);
  const features = found.result.features.map((place) => {
    const { meters, nearest } = distancesFrom(positions, place);
    return { ...place, properties: { ...place.properties, ...tag(nearest, meters[nearest]) } };
  });
  return { ...found, result: { ...found.result, features } };
}

/** Most separate stretches one `maxDetour` search covers: each costs a request. */
const MAX_DETOUR_STRETCHES = 10;

const ALONG_ROUTE_POSITION_DOC =
  "Each place's `alongRoute` gives its distance (`meters`) and driving time (`seconds`) from " +
  "the start of the drive, and how far off the route it is (`offRouteMeters`).";

/** Plans the trip a route mode follows, and the stretches of it its `stretch` picks. */
async function planStretches(where: AlongRouteWhere | MaxDetourWhere) {
  const { routes, route, stretches, stops, stretch } = await planStretchedDrive(
    where,
    "No driving route connects the locations, so there is nothing to search along. Check " +
      'each location is reachable by road, or search around one with mode "nearby".'
  );
  const { lengthInMeters, travelTimeInSeconds } = route.properties.summary;
  return {
    routes,
    route,
    stretches,
    stops,
    searched: { route: { lengthInMeters, travelTimeInSeconds }, ...(stretch && { stretch }) },
  };
}

/** Plans the trip an `alongRoute` search follows, then searches the corridor along its stretches. */
async function searchCorridorScope(
  query: string,
  where: AlongRouteWhere,
  options: ScopeOptions
): Promise<ScopedSearch> {
  const { routes, route, stretches, stops, searched } = await planStretches(where);
  const meters = where.withinMeters ?? DEFAULT_CORRIDOR_METERS;
  const { limit } = options;
  const { places, matched, requests, incomplete } = await searchCorridor(
    stretches,
    meters,
    limit,
    (polygons, max) => searchInAreas(query, polygons, { ...options, limit: max })
  );
  const result: Places = { type: "FeatureCollection", features: places };
  return {
    result,
    complete: !incomplete.length && places.length < limit,
    matched,
    drivingOrder: {
      driveMeters: route.properties.summary.lengthInMeters,
      lastMeters: places.at(-1)?.properties.alongRoute.meters,
    },
    searched: {
      scope: `within ${meters} m of the drive ${stops}`,
      ...searched,
      order: `In the order the drive reaches them. ${ALONG_ROUTE_POSITION_DOC}`,
      ...(requests > 1 && { requests }),
      ...(incomplete.length && {
        incomplete,
        note:
          "These stretches (metres from the start) hold more places than one search returns, " +
          "so some there may be missing. Search them again with a narrower `stretch` or " +
          "`withinMeters`.",
      }),
    },
    appData: { route: routes, pois: withoutOpeningHours(result) },
  };
}

/** `place` with its detour offset measured from the start of the drive, not of its stretch. */
const withRouteOffset = (
  place: Place<AlongRoutePlaceProps>,
  fromMeters: number
): Place<AlongRoutePlaceProps> => {
  const offset = place.properties.detourOffsetInMeters;
  if (offset === undefined || !fromMeters) return place;
  return {
    ...place,
    properties: { ...place.properties, detourOffsetInMeters: Math.round(offset + fromMeters) },
  };
};

/** Plans the trip a `maxDetour` search runs along, then searches each stretch of it. */
async function searchDetours(
  query: string,
  where: MaxDetourWhere,
  options: ScopeOptions
): Promise<ScopedSearch> {
  const { routes, route, stretches, stops, searched } = await planStretches(where);
  if (stretches.length > MAX_DETOUR_STRETCHES) {
    throw new IncorrectError(
      "The stretch leaves more separate parts of the drive than a detour search covers " +
        '(`maxStretches`). Narrow it, or use mode "alongRoute" with `withinMeters`, which covers ' +
        "any number.",
      { maxStretches: MAX_DETOUR_STRETCHES, stretch: describeStretches(stretches, route) }
    );
  }
  const { limit } = options;
  const inRouteOrder = where.sortBy === "detourOffset";
  // The API keeps the `limit` smallest detours before it orders them, so the first
  // ones reached take its most, cut to `limit` here.
  const perStretch = inRouteOrder
    ? MAX_ALONG_ROUTE_RESULTS
    : Math.min(limit, MAX_ALONG_ROUTE_RESULTS);
  // Without a `stretch`, the planned route itself: the API takes it whole.
  const lines = where.stretch ? stretches.map(({ line }) => line) : [route];
  const results = await Promise.all(
    lines.map((line) =>
      searchAlongRoute(query, line, {
        ...options,
        limit: perStretch,
        maxDetourTimeSeconds: where.maxDetourTimeSeconds,
        sortBy: where.sortBy,
      })
    )
  );
  const byStretch = results.map((result, index) => {
    // The API measures the offset along the line it was sent: a stretch starts part-way.
    const fromMeters = where.stretch ? stretches[index].fromMeters : 0;
    return result.features.map((place) => {
      const shifted = withRouteOffset(place, fromMeters);
      return placeAlongRoute(shifted, stretches) ?? shifted;
    });
  });
  const sortKey = inRouteOrder ? "detourOffsetInMeters" : "detourTimeInSeconds";
  // In route order, the places past a stretch whose search was cut would skip the rest of it.
  const firstCapped = results.findIndex((stretch) => stretch.features.length >= perStretch);
  const kept = inRouteOrder && firstCapped >= 0 ? byStretch.slice(0, firstCapped + 1) : byStretch;
  // A place between two stretches is found from both: the first, nearest or soonest, stays.
  const found = dedupeBy(
    kept.flat().sort((a, b) => (a.properties[sortKey] ?? 0) - (b.properties[sortKey] ?? 0)),
    ({ id }) => id
  ).unique;
  const result: Places = { ...results[0], features: found.slice(0, limit) };
  const exact = firstCapped < 0;
  const last = result.features.at(-1);
  return {
    result,
    complete: exact && found.length <= limit,
    matched: { count: new Set(byStretch.flat().map(({ id }) => id)).size, exact },
    ...(inRouteOrder && {
      drivingOrder: {
        driveMeters: route.properties.summary.lengthInMeters,
        lastMeters: last && placeAlongRoute(last, stretches)?.properties.alongRoute.meters,
      },
    }),
    ...(perStretch === MAX_ALONG_ROUTE_RESULTS &&
      found.length <= limit && {
        beyondLimit:
          `A detour search returns at most ${MAX_ALONG_ROUTE_RESULTS} places per stretch, so a ` +
          'higher `limit` returns no more: narrow `stretch`, or use mode "alongRoute".',
      }),
    searched: {
      scope: `within a ${where.maxDetourTimeSeconds}s detour of the drive ${stops}`,
      ...searched,
      order:
        (inRouteOrder
          ? "Along the route, from the start."
          : "By the extra driving time each stop adds, NOT by where it is along the route. For " +
            'route order, search again with sortBy "detourOffset".') +
        ` ${ALONG_ROUTE_POSITION_DOC}`,
    },
    appData: { route: routes, pois: withoutOpeningHours(result) },
  };
}

/** Runs the search `where` asks for. */
async function searchScope(
  query: string,
  where: DiscoverWhere | undefined,
  options: ScopeOptions & Pick<DiscoverPlacesParams, "countries">
): Promise<ScopedSearch> {
  // An area or a route already says where, so `countries` has nothing to add to them.
  const { countries: _countries, ...areaOptions } = options;

  switch (where?.mode) {
    case "within": {
      const areas = await resolveWithin(where);
      return {
        ...(await searchAreas(query, areas.map(areaPolygon), areaOptions)),
        searched: {
          ...describeWithin(areas),
          order: "Nearest the centre of each area first.",
        },
      };
    }
    case "nearby": {
      if (where.positions) {
        if (where.position || where.query) {
          throw new IncorrectError(
            '`where` with mode "nearby" takes `positions` alone, or one `position` or `query`.'
          );
        }
        const radiusMeters = nearbyRadius(where);
        return {
          ...(await searchAround(query, where.positions, radiusMeters, areaOptions)),
          searched: {
            scope: describePositions(where.positions.length, radiusMeters),
            order:
              "Nearest each position first, in turn. Each place's `nearPosition` is the index in " +
              "`positions` of the one it is nearest, and `distance` its metres from it.",
          },
        };
      }
      const bias = await resolveNearby(where);
      const result = await fuzzySearch(query, {
        ...options,
        position: bias.position,
        radius: bias.radiusMeters,
      });
      return {
        result,
        searched: { scope: describeBias(bias) },
        appData: withSearchBoundary(result, [circleOf(bias).polygon]),
      };
    }
    case "alongRoute":
      return searchCorridorScope(query, where, areaOptions);
    case "maxDetour":
      return searchDetours(query, where, areaOptions);
    default: {
      const result = await fuzzySearch(query, options);
      return {
        result,
        searched: { scope: "global (no geographic constraint)" },
        appData: withoutOpeningHours(result),
      };
    }
  }
}

interface ChargerCount {
  connectorType: string;
  ratedPowerKW?: number;
  stations: number;
  connectors: number;
}

/** Why a search that returned the most `limit` takes counts no total. */
const ONE_SEARCH_CAP =
  `One search returns at most ${MAX_LIMIT} places, so this is no total and a higher ` +
  "`limit` returns no more: narrow the scope for a full count.";

/**
 * What share of the matches came back, and how to get the rest: agents told only
 * that "more matched" counted the places returned as the answer.
 */
function coverage(
  returned: number,
  complete: boolean,
  matched?: Matched,
  beyondLimit?: string
): string {
  if (complete) return "Every place the search matched.";
  if (beyondLimit) {
    const share =
      matched && matched.count > returned
        ? `${returned} of at least ${matched.count} places the search matched`
        : `At least ${returned} places matched`;
    return `${share}. ${beyondLimit}`;
  }
  if ((!matched || matched.count <= returned) && returned >= MAX_LIMIT) {
    return `At least ${returned} places matched. ${ONE_SEARCH_CAP}`;
  }
  if (!matched || matched.count <= returned) {
    return `The ${returned} places returned; more matched. Narrow the scope or raise \`limit\` for a full count.`;
  }
  if (!matched.exact) {
    return `${returned} of at least ${matched.count} places the search matched. For a full count, raise \`limit\` (at most ${MAX_LIMIT}), or narrow the scope.`;
  }
  return (
    `${returned} of the ${matched.count} places the search matched. ` +
    (matched.count <= MAX_LIMIT
      ? `For all of them, search again with \`limit\` ${matched.count}.`
      : `For more, raise \`limit\` (at most ${MAX_LIMIT}), and narrow the scope.`)
  );
}

/**
 * Where a search in driving order that `limit` cut stops along the drive. Measured:
 * told only that 100 of 151 chargers came back, a model took the charger nearest
 * halfway from 100 that stopped 94 km into a 221 km drive.
 */
function reachIntoDrive(
  { driveMeters, lastMeters }: DrivingOrder,
  beyondLimit?: string
): string | undefined {
  if (lastMeters === undefined) return undefined;
  const km = (meters: number) => (meters / 1000).toFixed(1);
  return (
    `These are the first places in driving order: they stop ${km(lastMeters)} km into ` +
    `the ${km(driveMeters)} km drive, so none further on came back. For those, search again ` +
    `with \`stretch\` { from: ${Math.floor(lastMeters)} }${beyondLimit ? "." : ", or raise `limit`."}`
  );
}

/** What app data adds to the places: the outline of the area searched, or the drive. */
function drawnBeside(appData: ScopedSearch["appData"]): Partial<AreaSearch & AlongRoute> {
  if (appData && "route" in appData) return { route: appData.route };
  if (appData && "_searchBoundary" in appData) return { _searchBoundary: appData._searchBoundary };
  return {};
}

/**
 * Counts over the returned places by category and by connector type and power,
 * so a breakdown needs no counting by the agent: agents asked for one miscounted
 * a long list, or gave up on it.
 */
function summarizePlaces(
  places: Places,
  complete: boolean,
  {
    matched,
    drivingOrder,
    beyondLimit,
  }: Pick<ScopedSearch, "matched" | "drivingOrder" | "beyondLimit">
): Record<string, unknown> | undefined {
  const { features } = places;
  if (features.length < 2) return undefined;

  const byCategory: Record<string, number> = {};
  const chargers = new Map<string, ChargerCount>();
  for (const { properties } of features) {
    for (const category of new Set(properties.poi?.categories)) {
      countInto(byCategory, category);
    }
    const counted = new Set<string>();
    for (const { connector, count } of properties.chargingPark?.connectors ?? []) {
      const key = `${connector.type} ${connector.ratedPowerKW}`;
      const entry = chargers.get(key) ?? {
        connectorType: connector.type,
        ratedPowerKW: connector.ratedPowerKW,
        stations: 0,
        connectors: 0,
      };
      if (!counted.has(key)) entry.stations++;
      counted.add(key);
      entry.connectors += count;
      chargers.set(key, entry);
    }
  }

  const byConnector = [...chargers.values()].sort(
    (a, b) =>
      a.connectorType.localeCompare(b.connectorType) ||
      (a.ratedPowerKW ?? 0) - (b.ratedPowerKW ?? 0)
  );
  return {
    places: features.length,
    ...(!complete && matched && matched.count > features.length && { matched: matched.count }),
    covers: coverage(features.length, complete, matched, beyondLimit),
    ...(!complete && drivingOrder && { reaches: reachIntoDrive(drivingOrder, beyondLimit) }),
    ...(Object.keys(byCategory).length && { byCategory }),
    ...(byConnector.length && { byConnector }),
  };
}

/**
 * The categories to search: those the caller named, resolved; with charger filters
 * alone, charging stations; with no subject at all, the commonest kinds of place,
 * for a scope to browse.
 */
async function searchCategories(params: DiscoverPlacesParams) {
  const { query, poiCategories, where, language } = params;
  if (query || poiCategories?.length) {
    const categories = await resolvePoiCategories(poiCategories, language);
    if (poiCategories?.length && !categories.resolved) {
      throw new IncorrectError(
        "None of the poiCategories could be resolved to a POI category. Try a broader word " +
          '("restaurant" rather than "trattoria"), put the term in `query` instead, or call ' +
          "tomtom-poi-categories to browse the vocabulary.",
        { unresolved: categories.unresolved }
      );
    }
    return { ...categories, browsing: false };
  }
  if (chargerFilter(params)) {
    return { resolved: CHARGER_CATEGORIES, unresolved: [], browsing: false };
  }
  if ((where?.mode ?? "global") === "global") {
    throw new IncorrectError(
      "Provide a search subject: `query` (free text on the place NAME), `poiCategories`, " +
        "`minPowerKW`, `maxPowerKW` or `connectors`, or a `where` to browse. To locate ONE named place, use tomtom-locate-place instead."
    );
  }
  return { resolved: BROWSE_CATEGORIES, unresolved: [], browsing: true };
}

/**
 * The charger filters applied, as `searched.chargers`. A station that passes keeps
 * its slower connectors in the result, which otherwise reads as the filter having
 * let it through by mistake.
 */
function chargerFilter({ minPowerKW, maxPowerKW, connectors }: DiscoverPlacesParams) {
  if (!minPowerKW && !maxPowerKW && !connectors?.length) return undefined;
  return {
    chargers: {
      ...(minPowerKW && { minPowerKW }),
      ...(maxPowerKW && { maxPowerKW }),
      ...(connectors?.length && { connectors }),
      matched:
        "Every place returned has a connector that passes; its other connectors are listed too.",
    },
  };
}

export async function discoverPlacesHandler(params: DiscoverPlacesParams): Promise<ToolResponse> {
  const {
    query,
    where,
    language,
    countries,
    minPowerKW,
    maxPowerKW,
    connectors,
    show_ui = false,
    response_detail = "compact",
  } = params;
  const limit = params.limit ?? DEFAULT_SEARCH_LIMIT;

  try {
    // Checked before any request: an unsupported tag would only fail the last one.
    toSupportedLanguage(language);
    const { browsing, ...categories } = await searchCategories(params);
    const mode = where?.mode ?? "global";
    logger.debug({ mode, limit, categories: categories.resolved }, "Discover places");

    // An empty query is the category-only search.
    const { result, searched, appData, complete, ...reach } = await searchScope(
      query ?? "",
      where,
      {
        limit,
        ...(categories.resolved && { poiCategories: categories.resolved }),
        ...(language && { language }),
        ...(countries?.length && { countries }),
        minPowerKW,
        maxPowerKW,
        connectors,
      }
    );
    const summary = summarizePlaces(result, complete ?? result.features.length < limit, reach);

    return await buildToolResponse(result, trimSearchResponse, {
      showUI: show_ui,
      responseDetail: response_detail,
      appData,
      context: {
        // What was actually searched, so a surprising result set can be traced to
        // the scope rather than assumed to be a bad query.
        searched: {
          mode,
          ...searched,
          ...(categories.resolved && { poiCategories: categories.resolved }),
          ...(categories.unresolved.length && { unresolvedCategories: categories.unresolved }),
          ...(browsing && {
            browsed:
              "No query or poiCategories, so the commonest kinds of place were searched: those " +
              "listed in poiCategories. For others, name them in `poiCategories`.",
          }),
          ...chargerFilter(params),
        },
        ...(summary && { summary }),
        // A full result carries no app data, so the app draws it with what app data adds.
        ...(response_detail === "full" && drawnBeside(appData)),
      },
    });
  } catch (error: unknown) {
    return buildErrorResponse(error);
  }
}
