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
 * `resolveWhere` turns an area NAME into its boundary polygon. Which search
 * endpoint answers is this module's dispatch on `where.mode`.
 */

import { type BBox, bboxFromBBoxes, type Places, polygonFromBBox } from "@tomtom-org/maps-sdk/core";
import type { MultiPolygon, Polygon, Position } from "geojson";
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
  geocodeAddress,
  geocodeAreas,
  type PlacesSearchOptions,
  poiSearch,
  searchAlongRoute,
  searchInAreas,
} from "../../services/search/searchService";
import { IncorrectError } from "../../types/types";
import { logger } from "../../utils/logger";
import { type GeometryFeature, toFeature } from "../shared/geometry-response";
import { dedupeBy, fulfilledValues } from "../shared/in-batches";
import { resolveLocationInputs } from "../shared/inputs/location-input";
import { candidateLabel, rankLocateCandidates } from "../shared/inputs/place-names";
import { resolvePoiCategories } from "../shared/inputs/resolve-poi-categories";
import {
  boundaryOf,
  describeAreas,
  describeBias,
  resolvedAreasOf,
  resolveNearby,
  resolveWithin,
  splitNamedQuery,
} from "../shared/inputs/resolve-where";
import {
  buildErrorResponse,
  buildToolResponse,
  trimSearchResponse,
} from "../shared/response-trimmer";
import type { ToolResponse } from "../shared/tool-entry";

const DEFAULT_LIMIT = 10;

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
      "No driving route connects the locations, so there is nothing to search along.",
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
    },
    appData: { route: routes, pois: result },
  };
}

/** Runs the search `where` asks for. */
async function searchScope(
  query: string,
  where: DiscoverWhere | undefined,
  options: PlacesSearchOptions & { countries?: string[] }
): Promise<ScopedSearch> {
  const { countries, ...areaOptions } = options;
  if (countries?.length && (where?.mode === "within" || where?.mode === "maxDetour")) {
    throw new IncorrectError(
      "`countries` applies to modes nearby and global only: an area or a route already says where. Drop it.",
      { mode: where.mode, countries }
    );
  }

  switch (where?.mode) {
    case "within": {
      const areas = await resolveWithin(where);
      const geometries = areas.map((area) => area.polygon ?? polygonFromBBox(area.bbox).geometry);
      const result = await searchInAreas(query, geometries, areaOptions);
      const resolvedAreas = resolvedAreasOf(areas);
      const boundary = searchBoundaryOf(geometries);
      return {
        result,
        searched: { scope: describeAreas(areas), ...(resolvedAreas.length && { resolvedAreas }) },
        appData: { ...result, ...(boundary && { _searchBoundary: boundary }) },
      };
    }
    case "nearby": {
      const bias = await resolveNearby(where);
      const result = await fuzzySearch(query, {
        ...options,
        position: bias.position,
        radius: bias.radiusMeters,
      });
      return { result, searched: { scope: describeBias(bias) } };
    }
    case "maxDetour":
      return searchDetours(query, where, areaOptions);
    default:
      return {
        result: await fuzzySearch(query, options),
        searched: { scope: "global (no geographic constraint)" },
      };
  }
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
    if (!query && !params.poiCategories?.length) {
      throw new IncorrectError(
        "Provide a search subject: `query` (free text on the place NAME) or `poiCategories`. " +
          "To locate ONE named place, use tomtom-locate-place instead."
      );
    }

    const categories = await resolvePoiCategories(params.poiCategories, language);
    if (params.poiCategories?.length && !categories.resolved) {
      throw new IncorrectError(
        "None of the poiCategories could be resolved to a POI category. Try a broader word " +
          '("restaurant" rather than "trattoria"), put the term in `query` instead, or call ' +
          "tomtom-poi-categories to browse the vocabulary.",
        { unresolved: categories.unresolved }
      );
    }

    const mode = where?.mode ?? "global";
    logger.info({ mode, limit, categories: categories.resolved }, "Discover places");

    // An empty query is the category-only search.
    const { result, searched, appData } = await searchScope(query ?? "", where, {
      limit,
      ...(categories.resolved && { poiCategories: categories.resolved }),
      ...(language && { language }),
      ...(countries?.length && { countries }),
    });

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
        },
      },
    });
  } catch (error: unknown) {
    return buildErrorResponse(error, "Discover places");
  }
}

/** Where to look: a hard bounding box, a soft point bias, or neither. */
interface LocateScope {
  bias?: Position;
  boundingBox?: BBox;
}

/**
 * Works out what area to confine a lookup to.
 *
 * An explicit `where` always wins. Failing that, the query's own tail is used —
 * "Dam Square, Amsterdam" says where to look and nothing was reading it, which
 * is how "Eiffel Tower, Paris" found Paris, Texas.
 */
const resolveLocateScope = async (
  where: LocatePlaceParams["where"],
  area: string | undefined
): Promise<LocateScope> => {
  if (where?.mode === "within") {
    // Only a bbox can constrain a geocode, so a polygon is reduced to its bounds.
    //
    // Deliberately NO position bias. Sending a centre point alongside the box
    // defeats the box: geocoding "Dam Square" with the Amsterdam bbox alone
    // returns "Dam, 1012 Amsterdam", and adding the bbox centre as `position`
    // returns "Beaver Dam Place, Zion Crossroads, VA". A hard scope and a soft
    // bias are alternatives, not layers.
    const areas = await resolveWithin(where, { boundsOnly: true });
    return { boundingBox: bboxFromBBoxes(areas.map(({ bbox }) => bbox)) };
  }

  if (where?.mode === "nearby") return { bias: (await resolveNearby(where)).position };

  if (!area) return {};
  // Best effort. A tail that is not a place ("Rijksmuseum, the one near the
  // park") must not fail the lookup it was only meant to narrow — searching the
  // whole world is a worse answer, not an error.
  try {
    const [resolved] = await resolveWithin(
      { mode: "within", queries: [area] },
      { boundsOnly: true }
    );
    return { boundingBox: resolved.bbox };
  } catch (caught) {
    logger.debug({ area, error: String(caught) }, "Could not scope locate query to its tail");
    return {};
  }
};

export async function locatePlaceHandler(params: LocatePlaceParams): Promise<ToolResponse> {
  const { query, queryAs, where, show_ui = false, response_detail = "compact" } = params;
  const boundaryWanted = response_detail === "geometry";
  logger.info({ query, queryAs, boundaryWanted }, "Locate place");

  try {
    const { subject, area } = splitNamedQuery(query);
    const { bias, boundingBox } = await resolveLocateScope(where, area);

    const options = {
      // A handful of candidates, so an ambiguous name can be reported rather
      // than silently resolved to the first hit.
      limit: 5,
      ...(bias && { position: bias }),
      ...(boundingBox && { boundingBox }),
    };

    // BOTH indexes, because neither answers this alone — see
    // `rankLocateCandidates` — plus the areas index when a boundary is wanted,
    // since an unrestricted geocode of "Jordaan" can rank a street first.
    // Settled rather than awaited together: one index having nothing to say
    // about a name is the normal case, not a failure.
    const outcomes = await Promise.allSettled([
      poiSearch(query, options),
      geocodeAddress(query, options),
      ...(boundaryWanted ? [geocodeAreas(query, options)] : []),
    ]);
    const [poiResult, geoResult, areaResult] = outcomes;
    const featuresOf = (outcome: PromiseSettledResult<Places> | undefined) =>
      outcome?.status === "fulfilled" ? outcome.value.features : [];

    // The areas index and the geocoder return the same area for an area's name.
    const { unique: candidates } = dedupeBy(
      [areaResult, poiResult, geoResult].flatMap(featuresOf),
      (place) => place.id
    );
    const {
      ranked: features,
      matchedByName,
      exactMatches,
    } = rankLocateCandidates(candidates, subject, { area, boundaryWanted, queryAs });

    if (features.length === 0) {
      const rejected = outcomes.find((outcome) => outcome.status === "rejected");
      if (rejected) throw rejected.reason;
      throw new IncorrectError(
        "Could not locate the query. Neither the POI index nor the geocoder returned a match. " +
          "Try a simpler name, or give `where` to say which area to look in.",
        { query }
      );
    }

    // Keep whichever collection actually came back as the envelope (its
    // `properties` carry the provider's query echo), with the merged, ranked
    // features in place of its own.
    const [envelope] = fulfilledValues<Places>(outcomes);
    const response: Places = { ...envelope, features };
    const boundary = boundaryWanted ? await boundaryOf(features[0]) : undefined;

    // With no viewport there is nothing to re-rank ambiguous names against, so
    // surface the alternatives instead of pretending the top hit is certain.
    const alternatives = features.slice(1, 4).map(candidateLabel);

    return await buildToolResponse(
      response,
      (full) => trimSearchResponse({ ...full, features: full.features.slice(0, 1) }),
      {
        showUI: show_ui,
        responseDetail: response_detail,
        appData: { ...response, features: features.slice(0, 4) },
        geometry: (full) => [toFeature(boundary ?? full.features[0]?.geometry, { place: 0 })],
        context: {
          located: candidateLabel(features[0]),
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
          // inference. Saying so is the difference between an answer and a
          // guess presented as one — and a model told this can report the
          // doubt instead of quietly substituting what it already believed.
          ...(!matchedByName && {
            matchNote:
              `Nothing is named exactly "${subject}"; the closest match is the place named in ` +
              "`located`. Its coordinates are that place's and are correct for it — report " +
              "them, and say which place they came from, so the user can redirect you if it " +
              "is the wrong one. Do not replace them with coordinates from memory.",
          }),
          // Two records can carry the same name and the same category —
          // Amsterdam has a second "Rijksmuseum" 1.7 km from the museum — and
          // the provider's order between them is not stable. There is nothing
          // in the data to choose with, so the tie is reported rather than
          // broken by whichever happened to come back first.
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
