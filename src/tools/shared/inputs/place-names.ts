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
 * What a place is called on its own: the venue's name, or the first part of an
 * area's or address's label, which goes on to name where it is ("Paris, TX").
 */
const ownName = (place: Place): string =>
  place.properties.poi?.name ?? place.properties.address?.freeformAddress?.split(",")[0] ?? "";

/** A leading article, which a name is written with or without: "De Jordaan" is the Jordaan. */
const ARTICLE = /^(the|de|het|la|le|les|el|los|las|il|lo|l|der|die|das) /;

/** A name by {@link normaliseName}, without a leading article. */
const bareName = (name: string): string => normaliseName(name).replace(ARTICLE, "");

/** Whether a place is called exactly `subject`, with or without a leading article. */
export const isNamed = (place: Place, subject: string): boolean =>
  bareName(ownName(place)) === bareName(subject);

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

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
 * Whether a candidate sits in the area the query named, read off its address as
 * whole words: ", Nice" is not in Venice. Each comma-separated part of the area
 * matches on its own ("Paris, Texas"), since the address fields come in their own
 * order: a town, its state or province, or its country by its English name, its
 * codes or a common alias ("UK"). The same search labels one record "Italia" and
 * the next "Italy".
 */
export const inNamedArea = (place: Place, area: string | undefined): boolean => {
  if (!area) return true;
  const address = place.properties.address;
  const addressWords = normaliseName(
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
  const hasWords = (part: string): boolean => ` ${addressWords} `.includes(` ${part} `);
  return (
    addressWords.length === 0 ||
    area
      .split(",")
      .map(normaliseName)
      .filter(Boolean)
      .every((part) => {
        const aliased = COUNTRY_ALIASES[part];
        return hasWords(part) || (!!aliased && address?.countryCode === aliased);
      })
  );
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
 * "Alexanderplatz, Berlin" is the square, not the Christmas market on it.
 * Unqualified, an exact name proves nothing; it is how the Legoland ride, or the
 * hamlet, "Frankfurt" would beat Frankfurt am Main. A country is the exception,
 * since no two share a name: "Greece" is the country the search ranks second,
 * not Greece, NY. Among candidates the search scores the same, one with a
 * website or phone number comes first: "Westerkerk, Amsterdam" is the church,
 * not the park record of that name it scores equally and lists first. Other ties
 * keep provider order.
 * What the result returns (`response_detail`) never changes the place it is about.
 */
export const rankPlaceCandidates = <T extends Place>(
  features: readonly T[],
  subject: string,
  area?: string
): { ranked: T[]; matchedByName: boolean; exactMatches: number } => {
  const isExact = (feature: T): boolean => isNamed(feature, subject);
  const rankOf = (feature: T): number =>
    (inNamedArea(feature, area) ? 0 : 4) +
    (isCountry(feature) && isExact(feature) ? 0 : 2) +
    (area && isExact(feature) ? 0 : 1);
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
    matchedByName: ranked.length > 0 && isExact(ranked[0]),
    exactMatches: ranked.filter(isExact).length,
  };
};
