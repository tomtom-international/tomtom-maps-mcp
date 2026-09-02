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
 * Resolves a MIXED list of POI inputs — exact codes or natural language — to
 * canonical category codes.
 *
 * Ported from the agent toolkit's `tools/shared/resolve-poi-categories.ts`, and
 * the single detail that deletes a mandatory hop. `tomtom-poi-categories`
 * currently tells the model *"REQUIRED before using poiCategories in any search
 * tool… Never guess or hardcode category codes"*, which was honest, because the
 * search tools only accepted exact codes. Resolve the terms inside the search
 * tool and the category tool becomes an optional way to browse the vocabulary
 * rather than a toll gate on every category search.
 *
 * Unresolved terms come back separately so the caller can say precisely which
 * term failed instead of silently searching for less than was asked.
 */

import { poiCategories as knownPoiCategories, type POICategory } from "@tomtom-org/maps-sdk/core";
import { fetchPOICategories } from "../../../services/search/searchService";
import { logger } from "../../../utils/logger";

const knownCodes = new Set<string>(knownPoiCategories);

export interface ResolvedPoiCategories {
  /** The search filter: exact codes kept as-is, plus codes resolved from terms. */
  resolved: POICategory[] | undefined;
  /** Inputs that matched neither an exact code nor any synonym. */
  unresolved: string[];
}

/**
 * @param inputs Mixed list — `"ELECTRIC_VEHICLE_STATION"` and `"italian food"`
 *   are both acceptable.
 */
export async function resolvePoiCategories(
  inputs: readonly string[] | undefined
): Promise<ResolvedPoiCategories> {
  if (!inputs?.length) return { resolved: undefined, unresolved: [] };

  const exact = inputs.filter((c) => knownCodes.has(c)) as POICategory[];
  const terms = inputs.filter((c) => !knownCodes.has(c));

  if (terms.length === 0) {
    return { resolved: exact.length ? exact : undefined, unresolved: [] };
  }

  // One lookup per term so a zero-match result is attributable to its input. The
  // SDK caches the catalogue in memory, so after the first call these are local
  // filters rather than N network round trips.
  const lookups = await Promise.all(
    terms.map(async (term) => {
      try {
        return { term, codes: await fetchPOICategories([term]) };
      } catch (caught) {
        logger.warn(
          { term, error: caught instanceof Error ? caught.message : caught },
          "POI category lookup failed"
        );
        return { term, codes: [] as unknown };
      }
    })
  );

  const unresolved: string[] = [];
  const fromTerms: POICategory[] = [];
  for (const { term, codes } of lookups) {
    // The service returns either a bare array of codes or a `{ categories }`
    // envelope depending on the endpoint shape; accept both.
    const list = Array.isArray(codes)
      ? codes
      : ((codes as { categories?: { code?: string }[] })?.categories ?? []);
    const resolvedCodes = list
      .map((entry) => (typeof entry === "string" ? entry : entry?.code))
      .filter((code): code is string => Boolean(code));
    if (resolvedCodes.length === 0) unresolved.push(term);
    else fromTerms.push(...(resolvedCodes as POICategory[]));
  }

  const merged = [...new Set([...exact, ...fromTerms])];
  return { resolved: merged.length ? merged : undefined, unresolved };
}

/**
 * The `poiCategories` field description, shared by the tools that accept it.
 *
 * States that natural language is fine — otherwise a model that has read the old
 * `tomtom-poi-categories` description will keep making the pre-flight call out of
 * caution, and the saved hop is only saved if the model believes it can skip it.
 */
export const POI_CATEGORIES_DOC =
  'Category filter. Natural language IS accepted — "italian food", "gym", "ev charging" are ' +
  "resolved to codes server-side, so you do NOT need to call tomtom-poi-categories first. " +
  "Exact CONSTANT_CASE codes also work and skip the lookup: common ones are RESTAURANT, CAFE, BAR, " +
  "HOTEL, PARK, ELECTRIC_VEHICLE_STATION, GAS_STATION, PARKING_GARAGE, SUPERMARKETS_HYPERMARKETS, " +
  "PHARMACY, ATM. " +
  "Batch every requested category into ONE array — never one call per category. " +
  "Anything that cannot be resolved is reported back so you know what was dropped.";
