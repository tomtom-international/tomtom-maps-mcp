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
 * Matching a place NAME against the candidates a name search returns, so
 * `tomtom-locate-place`, a `where.nearby.query` and a route stop pick the same
 * place for the same name.
 */

import type { Place } from "@tomtom-org/maps-sdk/core";
import { isCountry } from "../../../services/search/searchService";

/** Case-, accent- and punctuation-insensitive form, for comparing place names. */
export const normaliseName = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** A place's own name: the venue's for a POI, the address for anything else. */
export const placeName = (place: Place): string | undefined =>
  place.properties.poi?.name ?? place.properties.address?.freeformAddress;

/** A place's name for reporting, never empty. */
export const candidateLabel = (place: Place): string => placeName(place) ?? "(unnamed)";

/**
 * Where the search says a label's place is, after a name places elsewhere share:
 * "Utrecht (NL)", "Manchester (GB, England, Greater Manchester)".
 */
const DISAMBIGUATION = / \([^()]*\)$/;

/**
 * What a place is called on its own: the venue's name, or the first part of an
 * area's or address's label, which goes on to name where it is ("Paris, TX").
 */
const ownName = (place: Place): string =>
  place.properties.poi?.name ??
  place.properties.address?.freeformAddress?.replace(DISAMBIGUATION, "").split(",")[0] ??
  "";

/** A leading article, which a name is written with or without: "De Jordaan" is the Jordaan. */
const ARTICLE = /^(the|de|het|la|le|les|el|los|las|il|lo|l|der|die|das) /;

/** A name by {@link normaliseName}, without a leading article. */
const bareName = (name: string): string => normaliseName(name).replace(ARTICLE, "");

/** Whether a place is called exactly `subject`, with or without a leading article. */
export const isNamed = (place: Place, subject: string): boolean =>
  bareName(ownName(place)) === bareName(subject);

/** Whether a place is a POI called exactly `subject`: the Colosseum, not a town of that name. */
export const isLandmarkNamed = (place: Place, subject: string): boolean =>
  place.properties.type === "POI" && isNamed(place, subject);

/**
 * Whether a place's name begins with `subject`, as a qualified name does ("Frankfurt
 * am Main"), rather than only holding it ("Drouvin-le-Marais").
 */
export const startsWithName = (place: Place, subject: string): boolean =>
  `${bareName(ownName(place))} `.startsWith(`${bareName(subject)} `);

/** {@link isNamed} with the article kept, which beats it: "El Salvador" is not Salvador. */
const isNamedVerbatim = (place: Place, subject: string): boolean =>
  normaliseName(ownName(place)) === normaliseName(subject);

/**
 * The candidates called `subject` in `area`, as the agent toolkit's `namedMatches`
 * picks them: those named with the article asked for, when any are.
 */
export const namedMatches = <T extends Place>(
  places: readonly T[],
  subject: string,
  area?: string
): T[] => {
  const asked = places.filter((place) => isNamed(place, subject) && inNamedArea(place, area));
  const verbatim = asked.filter((place) => isNamedVerbatim(place, subject));
  return verbatim.length ? verbatim : asked;
};

/**
 * Whether `word` abbreviates `full`: its letters in order, from the first ("NW"
 * for "northwest"). A number abbreviates only itself, so 10 Downing Street is not
 * number 1 or 11.
 */
const abbreviates = (word: string, full: string): boolean => {
  if (/\p{N}/u.test(word) || /\p{N}/u.test(full)) return word === full;
  let matched = 0;
  for (const letter of full) {
    if (letter === word[matched]) matched++;
  }
  return full.startsWith(word[0]) && matched === word.length;
};

/**
 * Whether `subject` is a place's name with words abbreviated, each in its place:
 * "Oxford St" is Oxford Street, but not Oxford Street East.
 */
const isNamedAbbreviated = (place: Place, subject: string): boolean => {
  const asked = bareName(subject).split(" ");
  const own = bareName(ownName(place)).split(" ");
  return asked.length === own.length && asked.every((word, index) => abbreviates(word, own[index]));
};

const countryNames = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });

/** Every country's English name, by {@link normaliseName}, from the ISO 3166-1 alpha-2 codes. */
const COUNTRY_NAMES: ReadonlySet<string> = new Set(
  Array.from({ length: 26 * 26 }, (_, index) =>
    countryNames.of(String.fromCharCode(65 + Math.floor(index / 26), 65 + (index % 26)))
  ).flatMap((name) => (name ? [normaliseName(name)] : []))
);

/** Whether `name` is a country's English name: "Malta", not Malta, NY. */
export const isCountryName = (name: string): boolean => COUNTRY_NAMES.has(normaliseName(name));

/** Country names people write that are neither the English name nor a code. */
const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  america: "US",
  britain: "GB",
  england: "GB",
  "great britain": "GB",
  holland: "NL",
  scotland: "GB",
  uk: "GB",
  usa: "US",
  wales: "GB",
};

/**
 * A place's address by {@link normaliseName}: its label, its town and regions,
 * and its country by name and codes. The same search labels one record "Italia"
 * and the next "Italy", so the English name is added from the code.
 */
const addressWordsOf = (place: Place): string => {
  const address = place.properties.address;
  return normaliseName(
    [
      address?.freeformAddress,
      address?.municipality,
      address?.municipalitySubdivision,
      address?.countrySecondarySubdivision,
      address?.countrySubdivision,
      address?.countrySubdivisionName,
      address?.country,
      address?.countryCode && countryNames.of(address.countryCode),
      address?.countryCode,
      address?.countryCodeISO3,
    ]
      .filter(Boolean)
      .join(" ")
  );
};

/** Whether normalised `words` hold `part` as whole words: "nice" is not in "venice". */
const holdsWords = (words: string, part: string): boolean => ` ${words} `.includes(` ${part} `);

/**
 * Whether a candidate sits in the area the query named, read off its address as
 * whole words: ", Nice" is not in Venice. Each comma-separated part of the area
 * matches on its own ("Paris, Texas"), since the address fields come in their own
 * order: a town, its state or province, or its country by its English name, its
 * codes or a common alias ("UK").
 */
export const inNamedArea = (place: Place, area: string | undefined): boolean => {
  if (!area) return true;
  const address = place.properties.address;
  const addressWords = addressWordsOf(place);
  const hasWords = (part: string): boolean => holdsWords(addressWords, part);
  return (
    addressWords.length === 0 ||
    area
      .split(",")
      .map(bareName)
      .filter(Boolean)
      .every((part) => {
        const aliased = COUNTRY_ALIASES[part];
        return hasWords(part) || (!!aliased && address?.countryCode === aliased);
      })
  );
};

/** Words that describe a part of an area rather than name one. */
const GENERIC_AREA_WORDS: ReadonlySet<string> = new Set([
  "area",
  "center",
  "central",
  "centre",
  "city",
  "district",
  "downtown",
  "historic",
  "inner",
  "neighborhood",
  "neighbourhood",
  "old",
  "quarter",
  "town",
]);

/**
 * The words of an area name its geocoded candidates lost, when they kept only its
 * generic ones: "Utrecht city centre" finds Sun City Center, FL, and no Utrecht.
 * Looked up on their own, they name the area.
 */
export const lostAreaWords = (
  query: string,
  candidates: readonly Place[]
): string[] | undefined => {
  const addresses = candidates.map(addressWordsOf);
  const carried = (word: string) => addresses.some((words) => holdsWords(words, word));
  const words = normaliseName(query)
    .split(" ")
    .filter((word) => word.length >= 3 && !ARTICLE.test(`${word} `));
  const lost = words.filter((word) => !carried(word) && !GENERIC_AREA_WORDS.has(word));
  const kept = words.filter(carried);
  return lost.length && kept.length && kept.every((word) => GENERIC_AREA_WORDS.has(word))
    ? lost
    : undefined;
};

/**
 * Orders a name search's candidates by how well each one IS the place asked for.
 *
 * The fuzzy search ranks the POI index and the geocoder together, and its order
 * is the best guide there is: it puts Frankfurt am Main ahead of a Legoland ride
 * named exactly "Frankfurt", and the address "Prinsengracht 263" ahead of the
 * streets of that name. Three things outrank it. A place in the area the query
 * names comes first: "Dam Square, Amsterdam" is not the business of that name in
 * Zeist. In that area, a place named exactly what was asked for comes next:
 * "Alexanderplatz, Berlin" is the square, not the Christmas market on it; and one
 * named with the article asked for before one without it. Unqualified, an exact name proves nothing; it is how the Legoland ride, or the
 * hamlet, "Frankfurt" would beat Frankfurt am Main. A country is the exception,
 * since no two share a name: "Greece" is the country the search ranks second,
 * not Greece, NY. Among candidates the search scores the same, one with a
 * website or phone number comes first: "Westerkerk, Amsterdam" is the church,
 * not the park record of that name it scores equally and lists first. Other ties
 * keep provider order.
 * What the result returns (`response_detail`) never changes the place it is about.
 *
 * `matchedByName` also holds for a first candidate whose name was asked for
 * abbreviated ("Oxford St"), which reorders nothing: it would put Baker Street in
 * London, Ontario before the one in London the search lists first.
 */
export const rankPlaceCandidates = <T extends Place>(
  features: readonly T[],
  subject: string,
  area?: string
): { ranked: T[]; matchedByName: boolean; exactMatches: number } => {
  const isExact = (feature: T): boolean => isNamed(feature, subject);
  const verbatim = features.filter((feature) => isNamedVerbatim(feature, subject));
  const rankOf = (feature: T): number =>
    (inNamedArea(feature, area) ? 0 : 8) +
    (isCountry(feature) && isExact(feature) ? 0 : 4) +
    (area && isExact(feature) ? (verbatim.includes(feature) ? 0 : 1) : 2);
  const unlisted = ({ properties: { poi } }: T): number => (poi?.url || poi?.phone ? 0 : 1);
  // The search sends a score the SDK's Place type does not declare.
  const scoreOf = (feature: T) => (feature.properties as { score?: number }).score;

  let tie = 0;
  const ranked = features
    .map((feature, index) => {
      if (index && scoreOf(feature) !== scoreOf(features[index - 1])) tie = index;
      return { feature, index, tie, rank: rankOf(feature) };
    })
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.tie - right.tie ||
        unlisted(left.feature) - unlisted(right.feature) ||
        left.index - right.index
    )
    .map(({ feature }) => feature);

  return {
    ranked,
    matchedByName:
      ranked.length > 0 && (isExact(ranked[0]) || isNamedAbbreviated(ranked[0], subject)),
    exactMatches: verbatim.length || ranked.filter(isExact).length,
  };
};
