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
 * Between them these replace SEVEN tools: `fuzzy-search`, `poi-search`, `nearby`,
 * `area-search`, `ev-search`, `search-along-route` and `geocode`. Those were one
 * tool per API endpoint, which pushed the joining onto the model: "Italian
 * restaurants in Amsterdam" meant resolving a category code, geocoding the city,
 * then searching — three round trips, two of them pure plumbing.
 *
 * Nothing moved to the client. Two resolvers absorbed the hops
 * (`shared/inputs/`): `resolvePoiCategories` accepts natural language, and
 * `resolveWhere` turns an area NAME into a boundary polygon. The endpoint choice
 * that used to be the model's tool choice is now this module's dispatch.
 */

import type { BBox } from "@tomtom-org/maps-sdk/core";
import * as turf from "@turf/turf";
import type { Position } from "geojson";
import type {
  DiscoverPlacesParams,
  LocatePlaceParams,
} from "../../schemas/search/discoverPlacesSchema";
import { datasetMeta, storeDataset } from "../../services/datasets/dataset-store";
import type { AreaSearchOptions } from "../../services/search/searchService";
import {
  fuzzySearch,
  geocodeAddress,
  poiSearch,
  searchEVStations,
  searchInArea,
  searchNearby,
  withEVAvailability,
} from "../../services/search/searchService";
import { handleApiError } from "../../utils/apiErrorHandler";
import { logger } from "../../utils/logger";
import { runToolQuery } from "../shared/analyse-result";
import { inBatches, MAX_AREAS_SEARCHED } from "../shared/in-batches";
import { resolvePoiCategories } from "../shared/inputs/resolve-poi-categories";
import {
  DEFAULT_NEARBY_RADIUS_METERS,
  describeAreas,
  inNamedArea,
  normaliseName,
  type ResolvedArea,
  resolveNearby,
  resolveWithin,
  splitNamedQuery,
} from "../shared/inputs/resolve-where";
import { trimSearchResponse } from "../shared/response-trimmer";
import type { ToolResponse } from "../shared/tool-entry";

const DEFAULT_LIMIT = 10;

/** EV searches get real-time availability, which was `ev-search`'s whole reason to exist. */
const EV_CATEGORY = "ELECTRIC_VEHICLE_STATION";

const fail = (message: string): ToolResponse => ({
  content: [{ type: "text", text: JSON.stringify({ error: message }) }],
  isError: true,
});

/** Centroid of a bbox, for the point-bias APIs. */

/**
 * Turns a resolved area into `searchInArea`'s geometry options.
 *
 * `searchInArea` takes ONE geometry, so several resolved areas mean several
 * calls, merged. This used to search the first and report the rest as ignored —
 * honest, but the eval showed what it costs: asked how many EV chargers fall
 * inside a 30-minute drive, the agent searched the first of four isochrone
 * polygons, got zero, and reported zero for the whole area. The note saying only
 * one area was searched was right there in the response and went unread.
 */
const areaToOptions = (area: ResolvedArea): Partial<AreaSearchOptions> => {
  if (area.polygon) {
    // A Polygon's outer ring; a MultiPolygon's first polygon's outer ring.
    const coords = area.polygon.coordinates as number[][][] | number[][][][];
    const ring = (
      area.polygon.type === "MultiPolygon"
        ? (coords as number[][][][])[0]?.[0]
        : (coords as number[][][])[0]
    ) as Position[] | undefined;
    if (ring?.length) return { polygon: ring };
  }
  if (area.bbox) {
    const [west, south, east, north] = area.bbox;
    return {
      boundingBox: [
        [west, north],
        [east, south],
      ] as [Position, Position],
    };
  }
  return {};
};

/**
 * Merges the per-area search responses into one result set.
 *
 * Deduplicates by feature id, because the areas are frequently nested — four
 * isochrone budgets from one origin contain each other, so a station inside the
 * 10-minute polygon is inside all four. Counting it four times would turn "how
 * many chargers can I reach" into a number about geometry rather than chargers.
 *
 * `limit` is the caller's cap on results, so it applies to the merged set rather
 * than to each area; searching four areas must not quietly return four times
 * what was asked for.
 */
const mergeAreaResults = (
  responses: readonly unknown[],
  limit: number
): { response: unknown; duplicates: number; matchedBeforeLimit: number } => {
  const base = (responses[0] ?? {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const features: unknown[] = [];
  let duplicates = 0;

  for (const response of responses) {
    const batch = ((response as { features?: unknown[] }).features ?? []) as unknown[];
    for (const feature of batch) {
      const candidate = feature as { id?: string; geometry?: unknown };
      // Fall back to geometry when a provider omits ids, so dedupe degrades to
      // "same place" rather than off.
      const key = candidate.id ?? JSON.stringify(candidate.geometry ?? feature);
      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }
      seen.add(key);
      features.push(feature);
    }
  }

  const capped = features.slice(0, limit);
  const baseProperties = (base.properties ?? {}) as Record<string, unknown>;
  return {
    response: {
      ...base,
      properties: { ...baseProperties, numResults: capped.length },
      features: capped,
    },
    duplicates,
    matchedBeforeLimit: features.length,
  };
};

export async function discoverPlacesHandler(params: DiscoverPlacesParams): Promise<ToolResponse> {
  const { query, where, language, countries, analyse, show_ui = true } = params;
  const limit = params.limit ?? DEFAULT_LIMIT;

  if (!query && !params.poiCategories?.length) {
    return fail(
      "Provide a search subject: `query` (free text on the place NAME) or `poiCategories`. " +
        "To locate ONE named place, use tomtom-locate-place instead."
    );
  }

  const categories = await resolvePoiCategories(params.poiCategories);
  // Set by the branch that enriches as part of the search, so the fallback below
  // does not pay for the same availability lookups twice.
  let enrichedWithAvailability = false;
  if (params.poiCategories?.length && !categories.resolved) {
    return fail(
      `None of these could be resolved to a POI category: ${categories.unresolved.join(", ")}. ` +
        "Try plainer words, drop the category filter and use `query` instead, or call " +
        "tomtom-poi-categories to browse the vocabulary."
    );
  }

  const mode = where?.mode ?? "global";
  logger.info({ mode, limit, categories: categories.resolved }, "Discover places");

  try {
    let result: unknown;
    let scope: string;
    /** Areas resolved but not searched, because of MAX_AREAS_SEARCHED. */
    let unsearchedAreas = 0;
    /** Areas whose search request failed while others succeeded. */
    let failedAreas = 0;
    /** Places found in more than one area — overlapping isochrones, usually. */
    let duplicateHits = 0;

    if (where?.mode === "within") {
      const areas = await resolveWithin(where);
      if ("error" in areas) return fail(areas.error);

      const usable = areas.value
        .map((area) => ({ area, geometry: areaToOptions(area) }))
        .filter(({ geometry }) => geometry.polygon || geometry.boundingBox);
      if (!usable.length) {
        return fail("The resolved area had no usable polygon or bounding box to search within.");
      }

      const targets = usable.slice(0, MAX_AREAS_SEARCHED);
      unsearchedAreas = areas.value.length - targets.length;
      scope = describeAreas(targets.map(({ area }) => area));

      // One request per area, in bounded batches. A single bad polygon returns
      // the areas that did work rather than failing the whole query — with the
      // count surfaced, since quietly returning a subset is the exact failure
      // this change exists to remove.
      const settled = await inBatches(targets, ({ geometry }) =>
        searchInArea({
          // "" is the category-only search; "*" is a literal term to the geometry
          // endpoint and matches nothing once a category filter is applied.
          query: query ?? "",
          limit,
          ...(categories.resolved && { poiCategories: categories.resolved }),
          ...(language && { language }),
          ...(countries?.length && { countries }),
          ...geometry,
        } as AreaSearchOptions)
      );

      const succeeded = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
      failedAreas = settled.length - succeeded.length;
      // Every area failing is a failed search, not an empty one.
      if (!succeeded.length) {
        throw (settled[0] as PromiseRejectedResult).reason;
      }

      const merged = mergeAreaResults(succeeded, limit);
      duplicateHits = merged.duplicates;
      result = merged.response;
    } else if (where?.mode === "nearby") {
      const resolvedBias = await resolveNearby(where);
      // A bias that cannot be resolved is fatal now. Widening here is what
      // answered "near Dam Square, Amsterdam" with Leesburg, Virginia.
      if ("error" in resolvedBias) return fail(resolvedBias.error);
      const bias = resolvedBias.value;
      scope = bias.position
        ? `within ${bias.radiusMeters}m of ${bias.label ?? bias.position.join(", ")}`
        : "no bias";

      if (!bias.position) {
        result = await fuzzySearch(query ?? "", {
          limit,
          ...(categories.resolved && { poiCategories: categories.resolved }),
          ...(language && { language }),
          ...(countries?.length && { countries }),
        });
      } else if (categories.resolved?.includes(EV_CATEGORY as never)) {
        // EV + a point is what `ev-search` was for: enrich with live availability.
        enrichedWithAvailability = true;
        result = await searchEVStations({
          position: bias.position,
          radius: bias.radiusMeters ?? DEFAULT_NEARBY_RADIUS_METERS,
          limit,
          ...(query && { query }),
          ...(language && { language }),
          ...(countries?.length && { countries }),
        });
      } else if (query) {
        result = await fuzzySearch(query, {
          position: bias.position,
          radius: bias.radiusMeters,
          limit,
          ...(categories.resolved && { poiCategories: categories.resolved }),
          ...(language && { language }),
          ...(countries?.length && { countries }),
        });
      } else {
        // Category-only around a point — what `nearby` did.
        result = await searchNearby(bias.position, {
          radius: bias.radiusMeters,
          limit,
          ...(categories.resolved && { poiCategories: categories.resolved }),
          ...(countries?.length && { countries }),
        } as Parameters<typeof searchNearby>[1]);
      }
    } else {
      scope = "global (no geographic constraint)";
      result = await fuzzySearch(query ?? "", {
        limit,
        ...(categories.resolved && { poiCategories: categories.resolved }),
        ...(language && { language }),
        ...(countries?.length && { countries }),
      });
    }

    // Availability is a property of the stations, not of how they were found. A
    // `within` or `global` EV search used to return stations with no availability
    // at all, and the model filled the gap in itself — measured, that is the one
    // task where this surface scored WORSE than the one it replaces.
    if (
      categories.resolved?.includes(EV_CATEGORY as never) &&
      !enrichedWithAvailability &&
      result
    ) {
      result = await withEVAvailability(result as Parameters<typeof withEVAvailability>[0]);
    }

    // An `analyse` asks a question OF this result instead of reading it, so it
    // short-circuits the projection entirely — see shared/query-result.ts.
    if (analyse) return runToolQuery(analyse, result, "Place discovery");

    const dataset = storeDataset({
      data: result,
      kind: "places",
      provenance: { tool: "tomtom-discover-places", params },
    });

    const trimmed = trimSearchResponse(result) as Record<string, unknown>;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ...trimmed,
              // What was actually searched, so a surprising result set can be
              // traced to the scope rather than assumed to be a bad query.
              searched: {
                mode,
                scope,
                ...(categories.resolved && { poiCategories: categories.resolved }),
                ...(categories.unresolved.length && {
                  unresolvedCategories: categories.unresolved,
                }),
                // Every departure from "all resolved areas were searched" is
                // stated. A count that silently covers part of the requested
                // scope is the failure mode this whole branch exists to avoid.
                ...(where?.mode === "within" && { areasSearched: scope.split(", ").length }),
                ...(duplicateHits > 0 && {
                  duplicatesMerged: duplicateHits,
                  duplicatesNote:
                    "Places found in more than one area were counted once. Overlapping or " +
                    "nested areas (isochrone budgets, for instance) are the usual cause.",
                }),
                ...(failedAreas > 0 && {
                  note:
                    `${failedAreas} of the resolved areas could not be searched; these results ` +
                    "cover the rest. Treat totals as a lower bound.",
                }),
                ...(unsearchedAreas > 0 && {
                  unsearchedAreas,
                  unsearchedNote:
                    `${unsearchedAreas} further area(s) were resolved but not searched (limit of ` +
                    `${MAX_AREAS_SEARCHED} per call) — narrow \`where\` or issue another call.`,
                }),
              },
              _meta: datasetMeta(dataset, show_ui),
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (caught) {
    const formatted = handleApiError(caught, "Discover places");
    logger.error({ error: formatted.message }, "Discover places failed");
    return fail(formatted.message);
  }
}

interface LocateCandidate {
  properties?: {
    type?: string;
    address?: { freeformAddress?: string; municipality?: string; country?: string };
    poi?: { name?: string };
  };
  geometry?: { type?: string; coordinates?: unknown };
}

const locateLabel = (feature: LocateCandidate): string =>
  feature.properties?.poi?.name ?? feature.properties?.address?.freeformAddress ?? "(unnamed)";

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
 *   1. failing that, a street, address or administrative area rather than a POI,
 *      on the grounds that a place with no venue of its own name is a place, not
 *      a hotel that borrowed it;
 *   2. failing that, whatever the provider ranked first.
 *
 * Ties keep provider order, so within a tier this is still the upstream ranking.
 */
const rankLocateCandidates = <T extends LocateCandidate>(
  features: readonly T[],
  subject: string,
  area?: string
): { ranked: T[]; matchedByName: boolean; exactMatches: number } => {
  const wanted = normaliseName(subject);
  const isExact = (feature: T): boolean => normaliseName(locateLabel(feature)) === wanted;
  const tierOf = (feature: T): number => (isExact(feature) ? 0 : 1);

  // Being in the area the query named outranks being the right KIND of thing,
  // but not being named the right thing: "Westminster, London" is returned as
  // "Westminster" with no mention of London, and it is still the answer.
  const sortKey = (feature: T): [number, number, number] => [
    tierOf(feature),
    inNamedArea(feature, area) ? 0 : 1,
    feature.properties?.type === "POI" ? 1 : 0,
  ];

  const ranked = features
    .map((feature, index) => ({ feature, index, key: sortKey(feature) }))
    .sort(
      (a, b) =>
        a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2] || a.index - b.index
    )
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
  error?: string;
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
    const areas = await resolveWithin(where);
    if ("error" in areas) return { error: areas.error };

    const boundingBox = areas.value.find((a) => a.bbox)?.bbox;
    if (boundingBox) return { boundingBox };

    const polygonArea = areas.value.find((a) => a.polygon);
    // Only a bbox can constrain a geocode, so derive one from the polygon.
    if (polygonArea?.polygon) {
      return {
        boundingBox: turf.bbox({
          type: "Feature",
          geometry: polygonArea.polygon as never,
          properties: {},
        }) as BBox,
      };
    }
    // Deliberately NO position bias. Sending a centre point alongside the box
    // defeats the box: geocoding "Dam Square" with the Amsterdam bbox alone
    // returns "Dam, 1012 Amsterdam", and adding the bbox centre as `position`
    // returns "Beaver Dam Place, Zion Crossroads, VA". A hard scope and a soft
    // bias are alternatives, not layers.
    return {};
  }

  if (where?.mode === "nearby") {
    const nearby = await resolveNearby(where);
    if ("error" in nearby) return { error: nearby.error };
    return { bias: nearby.value.position };
  }

  if (!area) return {};
  // Best effort. A tail that is not a place ("Rijksmuseum, the one near the
  // park") must not fail the lookup it was only meant to narrow — searching the
  // whole world is a worse answer, not an error.
  try {
    const areas = await resolveWithin({ mode: "within", queries: [area] } as never);
    if (!("error" in areas)) return { boundingBox: areas.value.find((a) => a.bbox)?.bbox };
  } catch (caught) {
    logger.debug({ area, error: String(caught) }, "Could not scope locate query to its tail");
  }
  return {};
};

export async function locatePlaceHandler(params: LocatePlaceParams): Promise<ToolResponse> {
  const { query, queryAs, where, includeGeometry = false, analyse, show_ui = true } = params;
  logger.info({ query, queryAs, includeGeometry }, "Locate place");

  try {
    const { subject, area } = splitNamedQuery(query);
    const scope = await resolveLocateScope(where, area);
    if (scope.error) return fail(scope.error);
    const { bias, boundingBox } = scope;

    const options = {
      // A handful of candidates, so an ambiguous name can be reported rather
      // than silently resolved to the first hit.
      limit: 5,
      ...(bias && { position: bias }),
      ...(boundingBox && { boundingBox }),
    };

    // BOTH indexes, because neither answers this alone — see
    // `rankLocateCandidates`. Settled rather than awaited together: one index
    // having nothing to say about a name is the normal case, not a failure.
    const [poiResult, geoResult] = await Promise.allSettled([
      poiSearch(query, options),
      geocodeAddress(query, options),
    ]);
    const featuresOf = (outcome: PromiseSettledResult<unknown>): LocateCandidate[] =>
      outcome.status === "fulfilled"
        ? (((outcome.value as { features?: unknown[] }).features ?? []) as LocateCandidate[])
        : [];

    // `queryAs` no longer picks the index; it breaks the tie when neither is a
    // better answer, so a caller who says "poi" still gets venues preferred.
    const [first, second] =
      queryAs === "place"
        ? [featuresOf(geoResult), featuresOf(poiResult)]
        : [featuresOf(poiResult), featuresOf(geoResult)];
    const {
      ranked: features,
      matchedByName,
      exactMatches,
    } = rankLocateCandidates([...first, ...second], subject, area);

    if (features.length === 0) {
      if (poiResult.status === "rejected") throw poiResult.reason;
      if (geoResult.status === "rejected") throw geoResult.reason;
      return fail(
        `Could not locate "${query}". Neither the POI index nor the geocoder returned a match. ` +
          "Try a simpler name, or give `where` to say which area to look in."
      );
    }

    // Keep whichever collection actually came back as the envelope (its
    // `properties` carry the provider's query echo), with the merged, ranked
    // features in place of its own.
    const envelope =
      (poiResult.status === "fulfilled" ? poiResult.value : undefined) ??
      (geoResult.status === "fulfilled" ? geoResult.value : undefined) ??
      {};
    const response = { ...(envelope as object), features };

    // An `analyse` asks a question OF this result instead of reading it, so it
    // short-circuits the projection entirely — see shared/query-result.ts.
    if (analyse) return runToolQuery(analyse, response, "Place lookup");

    const dataset = storeDataset({
      data: response,
      kind: "places",
      provenance: { tool: "tomtom-locate-place", params },
    });

    // With no viewport there is nothing to re-rank ambiguous names against, so
    // surface the alternatives instead of pretending the top hit is certain.
    const alternatives = features.slice(1, 4).map(locateLabel);
    const trimmed = trimSearchResponse({
      ...(response as object),
      features: includeGeometry ? features : features.slice(0, 1),
    }) as Record<string, unknown>;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ...trimmed,
              located: locateLabel(features[0]),
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
              ...(includeGeometry && {
                geometryNote:
                  "Pass this dataset_id as `where.dataset_ids` on tomtom-discover-places to " +
                  "search inside this place's boundary.",
              }),
              _meta: datasetMeta(dataset, show_ui),
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (caught) {
    const formatted = handleApiError(caught, "Locate place");
    logger.error({ error: formatted.message }, "Locate place failed");
    return fail(formatted.message);
  }
}
