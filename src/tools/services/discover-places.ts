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
 * `tomtom-discover-places` and `tomtom-locate-place` — the search surface.
 *
 * Two resolvers do the joining a model would otherwise do in extra calls
 * (`shared/inputs/`): `resolvePoiCategories` accepts natural language, and
 * `resolveWithin` and `resolveNearby` turn an area or landmark NAME into its
 * boundary polygon or point. Which search
 * endpoint answers is this module's dispatch on `where.mode`.
 */

import {
  bboxFromBBoxes,
  type POICategory,
  type Places,
  polygonFromBBox,
} from "@tomtom-org/maps-sdk/core";
import * as turf from "@turf/turf";
import type { MultiPolygon, Polygon } from "geojson";
import type {
  AlongRoute,
  AreaSearch,
  SearchBoundary,
} from "../../apps/map/places-and-routes/mapContent";
import {
  type DiscoverPlacesParams,
  type DiscoverWhere,
  type LocatePlaceParams,
  MAX_ALONG_ROUTE_RESULTS,
  type MaxDetourWhere,
} from "../../schemas/search/discoverPlacesSchema";
import { getRoute } from "../../services/routing/routingService";
import {
  fuzzySearch,
  type LookupOptions,
  type PlacesSearchOptions,
  searchAlongRoute,
  searchInAreas,
} from "../../services/search/searchService";
import { IncorrectError } from "../../types/types";
import { logger } from "../../utils/logger";
import { type GeometryFeature, toFeature } from "../shared/geometry-response";
import { resolveLocationInputs } from "../shared/inputs/location-input";
import { candidateLabel } from "../shared/inputs/place-names";
import { resolvePoiCategories } from "../shared/inputs/resolve-poi-categories";
import {
  boundariesOf,
  describeAreas,
  describeBias,
  knownAreaOf,
  resolvedAreasOf,
  resolveNearby,
  resolveWithin,
  searchPlaceName,
  splitNamedQuery,
} from "../shared/inputs/resolve-where";
import {
  buildErrorResponse,
  buildToolResponse,
  trimSearchResponse,
} from "../shared/response-trimmer";
import type { ToolResponse } from "../shared/tool-entry";

const DEFAULT_LIMIT = 10;

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
}

const isSearchBoundary = (feature: GeometryFeature): feature is GeometryFeature & SearchBoundary =>
  feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon";

/**
 * The searched areas as the one outline the app draws, rounded and capped to the
 * vertex budget as a `geometry` response is: a boundary can carry far more
 * vertices than an outline needs.
 */
const searchBoundaryOf = (
  areas: readonly (Polygon | MultiPolygon)[]
): SearchBoundary | undefined => {
  const merged: Polygon | MultiPolygon =
    areas.length === 1
      ? areas[0]
      : {
          type: "MultiPolygon",
          coordinates: areas.flatMap((area) =>
            area.type === "Polygon" ? [area.coordinates] : area.coordinates
          ),
        };
  const feature = toFeature(merged, {});
  return feature && isSearchBoundary(feature) ? feature : undefined;
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
  const byArea = centres.map(() => [] as { place: Places["features"][number]; meters: number }[]);
  for (const place of places.features) {
    const meters = centres.map((centre) =>
      turf.distance(centre, place.geometry.coordinates, { units: "meters" })
    );
    const nearest = meters.indexOf(Math.min(...meters));
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

/** Plans the trip a `maxDetour` search runs along, then searches it. */
async function searchDetours(
  query: string,
  where: MaxDetourWhere,
  options: PlacesSearchOptions
): Promise<ScopedSearch> {
  const stops = await resolveLocationInputs(where.locations, "location");
  const routes = await getRoute(stops.map((stop) => stop.position));
  const [route] = routes.features;
  if (!route) {
    throw new IncorrectError(
      "No driving route connects the locations, so there is nothing to search along. Check " +
        'each location is reachable by road, or search around one with mode "nearby".',
      {
        locations: stops.map(({ name }) => name),
      }
    );
  }
  const result = await searchAlongRoute(query, route, {
    ...options,
    ...(options.limit && { limit: Math.min(options.limit, MAX_ALONG_ROUTE_RESULTS) }),
    maxDetourTimeSeconds: where.maxDetourTimeSeconds,
    sortBy: where.sortBy,
  });
  const { lengthInMeters, travelTimeInSeconds } = route.properties.summary;
  return {
    result,
    searched: {
      scope: `within a ${where.maxDetourTimeSeconds}s detour of the drive ${stops.map(({ name }) => name).join(" → ")}`,
      route: { lengthInMeters, travelTimeInSeconds },
      order:
        where.sortBy === "detourOffset"
          ? "Along the route, from the start."
          : "By the extra driving time each stop adds, NOT by where it is along the route. For " +
            'route order, search again with sortBy "detourOffset".',
    },
    appData: { route: routes, pois: withoutOpeningHours(result) },
  };
}

/**
 * The places for the widget, which shows no opening hours: a week of time ranges
 * per place would crowd the map's data out of the result.
 */
const withoutOpeningHours = <T extends Places>(places: T): T => ({
  ...places,
  features: places.features.map((place) => {
    const { poi } = place.properties;
    if (!poi?.openingHours) return place;
    const { openingHours: _hours, timeZone: _zone, ...rest } = poi;
    return { ...place, properties: { ...place.properties, poi: rest } };
  }),
});

/** Runs the search `where` asks for. */
async function searchScope(
  query: string,
  where: DiscoverWhere | undefined,
  options: PlacesSearchOptions & { countries?: string[] }
): Promise<ScopedSearch> {
  // An area or a route already says where, so `countries` has nothing to add to them.
  const { countries: _countries, ...areaOptions } = options;

  switch (where?.mode) {
    case "within": {
      const areas = await resolveWithin(where);
      const geometries = areas.map((area) => area.polygon ?? polygonFromBBox(area.bbox).geometry);
      const limit = areaOptions.limit ?? DEFAULT_LIMIT;
      const pool = await searchInAreas(query, geometries, {
        ...areaOptions,
        limit: Math.max(limit, CENTRE_RANKING_POOL),
      });
      const result = centreFirst(pool, geometries, limit);
      const resolvedAreas = resolvedAreasOf(areas);
      const boundary = searchBoundaryOf(geometries);
      return {
        result,
        searched: {
          scope: describeAreas(areas),
          ...(resolvedAreas.length && { resolvedAreas }),
          order: "Nearest the centre of each area first.",
        },
        appData: { ...withoutOpeningHours(result), ...(boundary && { _searchBoundary: boundary }) },
      };
    }
    case "nearby": {
      const bias = await resolveNearby(where);
      const result = await fuzzySearch(query, {
        ...options,
        position: bias.position,
        radius: bias.radiusMeters,
      });
      const circle = turf.circle(bias.position, bias.radiusMeters, { units: "meters" }).geometry;
      const boundary = searchBoundaryOf([circle]);
      return {
        result,
        searched: { scope: describeBias(bias) },
        appData: { ...withoutOpeningHours(result), ...(boundary && { _searchBoundary: boundary }) },
      };
    }
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

const maxResultsOf = (where: DiscoverWhere | undefined): number =>
  where?.mode === "maxDetour" ? MAX_ALONG_ROUTE_RESULTS : Number.POSITIVE_INFINITY;

interface ChargerCount {
  connectorType: string;
  ratedPowerKW?: number;
  stations: number;
  connectors: number;
}

/**
 * Counts over the returned places by category and by connector type and power,
 * so a breakdown needs no counting by the agent: agents asked for one miscounted
 * a long list, or gave up on it.
 */
function summarizePlaces(places: Places, limit: number): Record<string, unknown> | undefined {
  const { features } = places;
  if (features.length < 2) return undefined;

  const byCategory: Record<string, number> = {};
  const chargers = new Map<string, ChargerCount>();
  for (const { properties } of features) {
    for (const category of new Set(properties.poi?.categories)) {
      byCategory[category] = (byCategory[category] ?? 0) + 1;
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
    covers:
      features.length < limit
        ? "Every place the search matched."
        : `The ${features.length} places returned; more matched. Narrow the scope or raise \`limit\` for a full count.`,
    ...(Object.keys(byCategory).length && { byCategory }),
    ...(byConnector.length && { byConnector }),
  };
}

/**
 * The categories to search: those the caller named, resolved; with no subject
 * at all, the commonest kinds of place, for a scope to browse.
 */
async function searchCategories({ query, poiCategories, where, language }: DiscoverPlacesParams) {
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
  if ((where?.mode ?? "global") === "global") {
    throw new IncorrectError(
      "Provide a search subject: `query` (free text on the place NAME) or `poiCategories`, " +
        "or a `where` to browse. To locate ONE named place, use tomtom-locate-place instead."
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
    show_ui = false,
    response_detail = "compact",
  } = params;
  const limit = params.limit ?? DEFAULT_LIMIT;

  try {
    const { browsing, ...categories } = await searchCategories(params);
    const mode = where?.mode ?? "global";
    logger.info({ mode, limit, categories: categories.resolved }, "Discover places");

    // An empty query is the category-only search.
    const { minPowerKW, maxPowerKW, connectors } = params;
    const { result, searched, appData } = await searchScope(query ?? "", where, {
      limit,
      ...(categories.resolved && { poiCategories: categories.resolved }),
      ...(language && { language }),
      ...(countries?.length && { countries }),
      minPowerKW,
      maxPowerKW,
      connectors,
    });
    const summary = summarizePlaces(result, Math.min(limit, maxResultsOf(where)));

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
      },
    });
  } catch (error: unknown) {
    return buildErrorResponse(error, "Discover places");
  }
}

/** Where to look: a hard bounding box, a point bias with an optional radius, or neither. */
type LocateScope = Omit<LookupOptions, "limit">;

/**
 * Works out what area to confine a lookup to, from an explicit `where`. Without
 * one the query's own tail ("Dam Square, Amsterdam") says where, in the ranking.
 */
const resolveLocateScope = async (where: LocatePlaceParams["where"]): Promise<LocateScope> => {
  if (where?.mode === "within") {
    // Only a bbox can constrain a lookup, so a polygon is reduced to its bounds.
    // No position bias with it: a centre point defeats the box ("Dam Square"
    // then geocodes to Beaver Dam Place, Virginia).
    const areas = await resolveWithin(where, { boundsOnly: true });
    return { boundingBox: bboxFromBBoxes(areas.map(({ bbox }) => bbox)) };
  }

  if (where?.mode === "nearby") {
    const { position } = await resolveNearby(where);
    return { position, ...(where.radiusMeters !== undefined && { radius: where.radiusMeters }) };
  }

  return {};
};

export async function locatePlaceHandler(params: LocatePlaceParams): Promise<ToolResponse> {
  const { query, where, show_ui = false, response_detail = "compact" } = params;
  const boundaryWanted = response_detail === "geometry";
  logger.info({ query, boundaryWanted }, "Locate place");

  try {
    const { subject } = splitNamedQuery(query);
    const {
      response: found,
      ranked: features,
      matchedByName,
      exactMatches,
    } = await searchPlaceName(query, await resolveLocateScope(where), { boundaryWanted });

    if (features.length === 0) {
      throw new IncorrectError(
        "Could not locate the query. Try a simpler name, or give `where` to say which area to " +
          "look in.",
        { query }
      );
    }

    const response: Places = { ...found, features };
    const [boundary] = boundaryWanted ? await boundariesOf([features[0]]) : [];

    // With no viewport there is nothing to re-rank ambiguous names against, so
    // surface the alternatives instead of pretending the top hit is certain.
    const alternatives = features.slice(1, 4).map(candidateLabel);
    const locatedArea = knownAreaOf(features[0]);

    return await buildToolResponse(
      response,
      (full) => trimSearchResponse({ ...full, features: full.features.slice(0, 1) }),
      {
        showUI: show_ui,
        responseDetail: response_detail,
        appData: withoutOpeningHours({ ...response, features: features.slice(0, 4) }),
        geometry: (full) => [toFeature(boundary ?? full.features[0]?.geometry, { place: 0 })],
        context: {
          located: candidateLabel(features[0]),
          ...(locatedArea && { area: locatedArea }),
          ...(boundaryWanted &&
            !boundary && {
              boundaryNote:
                "The located place has no boundary polygon, so `geometry` holds its point. For a " +
                'city, district or neighbourhood, name the area itself ("De Jordaan, Amsterdam").',
            }),
          ...(alternatives.length && {
            alternatives,
            note:
              "Several places matched. If the wrong one was chosen, disambiguate with " +
              '`where` (mode "nearby" to bias, "within" to restrict).',
          }),
          // Nothing was NAMED what was asked for, so the best match is an
          // inference; told so, a model reports the doubt rather than
          // substituting coordinates it already believed.
          ...(!matchedByName && {
            matchNote:
              `Nothing is named exactly "${subject}"; \`located\` is the closest match. Answer ` +
              "with its coordinates, naming the place they came from so the user can redirect " +
              "you. Do not replace them with coordinates from memory.",
          }),
          // Two records can share a name and category (Amsterdam has a second
          // "Rijksmuseum" 1.7 km away) in no stable order, so the tie is
          // reported rather than broken by whichever came back first.
          ...(exactMatches > 1 && {
            ambiguityNote:
              `${exactMatches} places are named exactly "${subject}". The first is reported; ` +
              "the rest are in `alternatives`. Narrow with `where` if the wrong one was chosen.",
          }),
        },
      }
    );
  } catch (error: unknown) {
    return buildErrorResponse(error, "Locate place");
  }
}
