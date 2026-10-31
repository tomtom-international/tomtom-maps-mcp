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
import { hasBoundary } from "../../../services/search/searchService";

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

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

/**
 * Whether a candidate sits in the area the query named, read off its address text
 * as whole words: ", Nice" is not in Venice. Each comma-separated part of the area
 * matches on its own ("Amsterdam, NL"), since the address fields come in their own
 * order. The country also matches by its English name and its codes, since the
 * same search labels one record "Italia" and the next "Italy".
 */
export const inNamedArea = (place: Place, area: string | undefined): boolean => {
  if (!area) return true;
  const address = place.properties.address;
  const haystack = normaliseName(
    [
      address?.freeformAddress,
      address?.municipality,
      address?.country,
      address?.countryCode && countryNames.of(address.countryCode),
      address?.countryCode,
      address?.countryCodeISO3,
    ]
      .filter(Boolean)
      .join(" ")
  );
  return (
    haystack.length === 0 ||
    area
      .split(",")
      .map(normaliseName)
      .filter(Boolean)
      .every((part) => ` ${haystack} `.includes(` ${part} `))
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
 * Unqualified, an exact name proves nothing; it is how the Legoland ride
 * "Frankfurt" would beat Frankfurt am Main. And when a boundary is wanted, a
 * place that has one comes before every place that has not: the outline of
 * "De Jordaan" is the neighbourhood's, not a café's. Ties keep provider order.
 */
export const rankPlaceCandidates = <T extends Place>(
  features: readonly T[],
  subject: string,
  { area, boundaryWanted = false }: { area?: string; boundaryWanted?: boolean } = {}
): { ranked: T[]; matchedByName: boolean; exactMatches: number } => {
  const wanted = normaliseName(subject);
  const isExact = (feature: T): boolean => normaliseName(candidateLabel(feature)) === wanted;
  const rankOf = (feature: T): number =>
    (boundaryWanted && !hasBoundary(feature) ? 4 : 0) +
    (inNamedArea(feature, area) ? 0 : 2) +
    (area && isExact(feature) ? 0 : 1);

  const ranked = features
    .map((feature, index) => ({ feature, index, rank: rankOf(feature) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ feature }) => feature);

  return {
    ranked,
    matchedByName: ranked.length > 0 && isExact(ranked[0]),
    exactMatches: ranked.filter(isExact).length,
  };
};
