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
 * Matching a place NAME against the candidates the POI index and the geocoder
 * return, so `tomtom-locate-place` and a `where.nearby.query` pick the same place
 * for the same name.
 */

import type { Place } from "@tomtom-org/maps-sdk/core";
import * as turf from "@turf/turf";
import type { z } from "zod";
import { hasBoundary } from "../../../services/search/searchService";
import type { queryAsSchema } from "./location-input";

/** How close two candidates must be to vouch for each other. */
const CORROBORATION_METERS = 300;

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

/** Whether a candidate sits in the area the query named, read off its address text. */
export const inNamedArea = (place: Place, area: string | undefined): boolean => {
  if (!area) return true;
  const address = place.properties.address;
  const haystack = normaliseName(
    [address?.freeformAddress, address?.municipality, address?.country].filter(Boolean).join(" ")
  );
  return haystack.length === 0 || haystack.includes(normaliseName(area));
};

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
export const rankLocateCandidates = <T extends Place>(
  features: readonly T[],
  subject: string,
  options: {
    area?: string;
    boundaryWanted?: boolean;
    queryAs?: z.infer<typeof queryAsSchema>;
  } = {}
): { ranked: T[]; matchedByName: boolean; exactMatches: number } => {
  const { area, boundaryWanted = false, queryAs } = options;
  const wanted = normaliseName(subject);
  const wantedWords = new Set(wanted.split(" "));
  const isExact = (feature: T): boolean => normaliseName(candidateLabel(feature)) === wanted;
  const tierOf = (feature: T): number => (isExact(feature) ? 0 : 1);
  // An address label carries its postcode and city after the first comma.
  const shortensSubject = (feature: T): boolean =>
    normaliseName(candidateLabel(feature).split(",")[0])
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
