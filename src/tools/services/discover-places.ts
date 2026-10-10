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

import { type BBox, type Place, type Places, polygonFromBBox } from "@tomtom-org/maps-sdk/core";
import * as turf from "@turf/turf";
import type { Position } from "geojson";
import type {
  DiscoverPlacesParams,
  DiscoverWhere,
  LocatePlaceParams,
  MaxDetourWhere,
} from "../../schemas/search/discoverPlacesSchema";
import { getRoute } from "../../services/routing/routingService";
import {
  fuzzySearch,
  geocodeAddress,
  geocodeAreas,
  hasBoundary,
  type PlacesSearchOptions,
  poiSearch,
  searchAlongRoute,
  searchInAreas,
} from "../../services/search/searchService";
import { IncorrectError } from "../../types/types";
import { logger } from "../../utils/logger";
import { toFeature } from "../shared/geometry-response";
import { fulfilledValues } from "../shared/in-batches";
import { resolveLocationInputs } from "../shared/inputs/location-input";
import { resolvePoiCategories } from "../shared/inputs/resolve-poi-categories";
import {
  boundaryOf,
  describeAreas,
  describeBias,
  inNamedArea,
  normaliseName,
  placeName,
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
/** How close two locate candidates must be to vouch for each other. */
const CORROBORATION_METERS = 300;

/** The result of one scope's search, and how to report what it covered. */
interface ScopedSearch {
  result: Places;
  searched: Record<string, unknown>;
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
      "No driving route connects the locations, so there is nothing to search along.",
      {
        locations: stops.map(({ name }) => name),
      }
    );
  }
  const result = await searchAlongRoute(query, route, {
    ...options,
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
      const result = await searchInAreas(
        query,
        areas.map((area) => area.polygon ?? polygonFromBBox(area.bbox).geometry),
        areaOptions
      );
      const resolvedAreas = resolvedAreasOf(areas);
      return {
        result,
        searched: { scope: describeAreas(areas), ...(resolvedAreas.length && { resolvedAreas }) },
      };
    }
    case "nearby": {
      const bias = await resolveNearby(where);
      const result = await fuzzySearch(query, {
        ...options,
        ...(bias.position && { position: bias.position, radius: bias.radiusMeters }),
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
    const { result, searched } = await searchScope(query ?? "", where, {
      limit,
      ...(categories.resolved && { poiCategories: categories.resolved }),
      ...(language && { language }),
      ...(countries?.length && { countries }),
    });

    return await buildToolResponse(result, trimSearchResponse, {
      showUI: show_ui,
      responseDetail: response_detail,
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

const locateLabel = (feature: Place): string => placeName(feature) ?? "(unnamed)";

/**
 * Orders candidates by how well each one IS the place that was asked for.
 *
 * Neither index answers this alone. Asked for "Dam Square, Amsterdam" the POI
 * index returns Penthouse Amsterdam Dam Square, Hotel Damsquare and Dam Square
 * Inn — businesses named after the square, with the square itself nowhere in the
 * list — while the geocoder, scoped to Amsterdam, returns "Dam, 1012 Amsterdam",
 * which is the answer. Asked for "Amsterdam Centraal" it is the other way round.
 *
 * So both are consulted and the result is chosen rather than assumed:
 *
 *   0. a name that EQUALS the subject — "Rijksmuseum" over "Rijksmuseum
 *      Research Library Amsterdam", "Eiffel Tower" over "Eiffel Tower Paris
 *      Texas";
 *   1. failing that, a candidate another candidate stands next to. Listings that
 *      borrow a name are scattered: five "Eiffel Tower Paris" POIs, none of them
 *      the tower, while Avenue Gustave Eiffel and the Esplanade de la Tour Eiffel
 *      meet at it; the Templo de la Sagrada Familia faces its Plaça, and the Calle
 *      de la Sagrada Familia is 7 km away on its own;
 *   2. failing that, a name the subject only shortens ("Dam" for "Dam Square")
 *      over one that adds words to it ("Penthouse Amsterdam Dam Square");
 *   3. failing that, the index `queryAs` names, then the provider's order.
 *
 * When a boundary is wanted, a place that has one outranks every place that has
 * not: asked for the outline of "De Jordaan", the neighbourhood is the answer and
 * a café of that name is not. Ties keep provider order.
 */
const rankLocateCandidates = <T extends Place>(
  features: readonly T[],
  subject: string,
  options: { area?: string; boundaryWanted: boolean; queryAs: LocatePlaceParams["queryAs"] }
): { ranked: T[]; matchedByName: boolean; exactMatches: number } => {
  const { area, boundaryWanted, queryAs } = options;
  const wanted = normaliseName(subject);
  const wantedWords = new Set(wanted.split(" "));
  const isExact = (feature: T): boolean => normaliseName(locateLabel(feature)) === wanted;
  const tierOf = (feature: T): number => (isExact(feature) ? 0 : 1);
  // An address label carries its postcode and city after the first comma.
  const shortensSubject = (feature: T): boolean =>
    normaliseName(locateLabel(feature).split(",")[0])
      .split(" ")
      .every((word) => word && wantedWords.has(word));
  const isCorroborated = (feature: T): boolean =>
    features.some(
      (other) =>
        other !== feature &&
        turf.distance(feature.geometry.coordinates, other.geometry.coordinates, {
          units: "meters",
        }) <= CORROBORATION_METERS
    );
  const isPoi = (feature: T): boolean => feature.properties?.type === "POI";

  // Being in the area the query named outranks being the right KIND of thing,
  // but not being named the right thing: "Westminster, London" is returned as
  // "Westminster" with no mention of London, and it is still the answer.
  const sortKey = (feature: T): number[] => [
    boundaryWanted && !hasBoundary(feature) ? 1 : 0,
    tierOf(feature),
    inNamedArea(feature, area) ? 0 : 1,
    isCorroborated(feature) ? 0 : 1,
    shortensSubject(feature) ? 0 : 1,
    isPoi(feature) === (queryAs === "poi") ? 0 : 1,
  ];
  const compareKeys = (left: number[], right: number[]): number =>
    left.reduce((order, value, index) => order || value - right[index], 0);

  const ranked = features
    .map((feature, index) => ({ feature, index, key: sortKey(feature) }))
    .sort((left, right) => compareKeys(left.key, right.key) || left.index - right.index)
    .map(({ feature }) => feature);

  return {
    ranked,
    matchedByName: ranked.length > 0 && tierOf(ranked[0]) === 0,
    exactMatches: ranked.filter((feature) => tierOf(feature) === 0).length,
  };
};

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
    const [first] = await resolveWithin(where);
    return { boundingBox: first.bbox };
  }

  if (where?.mode === "nearby") return { bias: (await resolveNearby(where)).position };

  if (!area) return {};
  // Best effort. A tail that is not a place ("Rijksmuseum, the one near the
  // park") must not fail the lookup it was only meant to narrow — searching the
  // whole world is a worse answer, not an error.
  try {
    const [resolved] = await resolveWithin({ mode: "within", queries: [area] });
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

    const candidates = [areaResult, poiResult, geoResult].flatMap(featuresOf);
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
    const alternatives = features.slice(1, 4).map(locateLabel);

    return await buildToolResponse(
      response,
      (full) => trimSearchResponse({ ...full, features: full.features.slice(0, 1) }),
      {
        showUI: show_ui,
        responseDetail: response_detail,
        geometry: (full) => [toFeature(boundary ?? full.features[0]?.geometry, { place: 0 })],
        context: {
          located: locateLabel(features[0]),
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
