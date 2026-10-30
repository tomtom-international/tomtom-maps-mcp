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
 * Resolves a mixed list of POI inputs — exact codes or natural language — to
 * category codes, through the maps-sdk's `resolvePOICategories`, so a category
 * search needs no `tomtom-poi-categories` call first. Unresolved words come back
 * separately so the response can name what was left out of the search.
 */

import { type POICategory, poiCategories } from "@tomtom-org/maps-sdk/core";
import { resolveCategories } from "../../../services/search/searchService";
import { normaliseName } from "./place-names";

const CODES = new Set<string>(poiCategories);

/** The code a word spells ("cafe", "Fuel station"), or the word itself. */
const asCode = (input: string): string => {
  const spelled = normaliseName(input).toUpperCase().replaceAll(" ", "_");
  return CODES.has(spelled) ? spelled : input;
};

export interface ResolvedPoiCategories {
  /** The search filter, or undefined when nothing was asked for or nothing matched. */
  resolved: POICategory[] | undefined;
  /** Inputs that matched no category. */
  unresolved: string[];
}

/**
 * @param inputs Mixed list — `"CHARGING_LOCATION"` and `"italian food"` are both acceptable.
 * @param language Language of the words, e.g. "nl-NL".
 */
export async function resolvePoiCategories(
  inputs: readonly string[] | undefined,
  language?: string
): Promise<ResolvedPoiCategories> {
  if (!inputs?.length) return { resolved: undefined, unresolved: [] };
  // Codes skip the SDK's catalog request, so a word that spells one is passed as it.
  const { poiCategories: resolved, unmatched } = await resolveCategories(inputs.map(asCode), {
    language,
  });
  return { resolved: resolved.length ? resolved : undefined, unresolved: unmatched };
}

/**
 * The `poiCategories` field description, shared by the tools that accept it. It says
 * natural language is accepted, which is what lets a model skip the category lookup.
 */
export const POI_CATEGORIES_DOC =
  'Category filter. Natural language IS accepted — "italian food", "gym", "ev charging" are ' +
  "resolved to codes server-side, so you do NOT need to call tomtom-poi-categories first. " +
  "Exact CONSTANT_CASE codes also work and skip the lookup: common ones are RESTAURANT, CAFE, BAR, " +
  "HOTEL, PARK, CHARGING_LOCATION, FUEL_STATION, PARKING_GARAGE, SUPERMARKET, " +
  "PHARMACY, ATM. " +
  "Batch every requested category into ONE array — never one call per category. " +
  "Anything that cannot be resolved is reported back so you know what was dropped.";
