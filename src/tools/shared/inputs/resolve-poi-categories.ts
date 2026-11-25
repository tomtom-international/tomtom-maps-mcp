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
import { isOneOf } from "../../../services/shared/sdkInputs";
import { normaliseName } from "./place-names";

/** The code a word spells ("cafe", "Fuel station"), or the word itself. */
const asCode = (input: string): string => {
  const spelled = normaliseName(input).toUpperCase().replaceAll(" ", "_");
  return isOneOf(poiCategories, spelled) ? spelled : input;
};

/** Words the category list matches to something else: "car park" finds rental car parking. */
const SYNONYMS: Record<string, string> = {
  "car park": "parking",
  "car parking": "parking",
};

/**
 * The singular of an English plural ("fuel stations", "pharmacies"), or undefined
 * for a word that is not one: the category list names each category once, in the
 * singular, and matches "restaurants" to nothing.
 */
function singularOf(words: string): string | undefined {
  if (/(ss|us|is)$/.test(words) || words.length < 4) return undefined;
  if (words.endsWith("ies")) return `${words.slice(0, -3)}y`;
  if (/(ch|sh|x|sses)es$/.test(words)) return words.slice(0, -2);
  return words.endsWith("s") ? words.slice(0, -1) : undefined;
}

/** What to look a word up as: its synonym or singular, when it has one; the word itself otherwise. */
function lookupWord(input: string, language: string | undefined): string {
  if (language && !language.toLowerCase().startsWith("en")) return input;
  const words = normaliseName(input);
  const singular = singularOf(words);
  return SYNONYMS[words] ?? (singular && (SYNONYMS[singular] ?? singular)) ?? input;
}

interface ResolvedPoiCategories {
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
  const codes = inputs.map(asCode);
  const lookups = codes.map((code, index) =>
    code === inputs[index] ? asCode(lookupWord(code, language)) : code
  );
  const first = await resolveCategories(lookups, { language });
  const missed = codes.filter((_, index) => first.unmatched.includes(lookups[index]));
  // A singular or synonym that matched nothing is tried again as the caller wrote it.
  const retry = missed.filter((code) => !lookups.includes(code));
  const second = retry.length
    ? await resolveCategories(retry, { language })
    : { poiCategories: [], unmatched: [] };
  const resolved = [...new Set([...first.poiCategories, ...second.poiCategories])];
  return {
    resolved: resolved.length ? resolved : undefined,
    unresolved: missed.filter((code) => !retry.includes(code) || second.unmatched.includes(code)),
  };
}
