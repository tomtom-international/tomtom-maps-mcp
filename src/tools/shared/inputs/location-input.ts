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
 * `locationInput` — the three ways to name a place, accepted everywhere.
 *
 * Ported from the agent toolkit's `tools/shared/location-input.ts`. This is the
 * single highest-leverage change in the phase-4 surface: `tomtom-routing` took
 * `locations: Position[]` — raw `[lng, lat]` — so "route from Amsterdam Centraal
 * to the Rijksmuseum" meant geocode, geocode, route. Three calls to express one
 * sentence, with the model hand-copying four floats between them.
 *
 * With this union it is one call, and because the same schema is reused by every
 * tool that means "a place", every tool accepts every way of saying one.
 *
 * The stateless divergence: the toolkit's third variant is
 * `{ placeIdOrEntryId }`, referring to its session state. Here it is
 * `{ dataset_id, featureIndex? }` — the phase-1 handles double as *inputs*, which
 * is what removes the "re-search for the place you already found" hop.
 */

import type { Place } from "@tomtom-org/maps-sdk/core";
import type { Position } from "geojson";
import { z } from "zod";
import { coordinateSchema } from "../../../schemas/routing/common";
import { requireDataset } from "../../../services/datasets/dataset-store";
import { extractFeatures } from "../../../services/datasets/summarize";
import { geocodeAddress, poiSearch } from "../../../services/search/searchService";
import { IncorrectError } from "../../../types/types";
import { placeName } from "./resolve-where";

/** `poi` = a venue/landmark/business; `place` = an address/city/geography. */
export const queryAsSchema = z
  .enum(["poi", "place"])
  .describe(
    'Which index to resolve the name against. "poi" for anything with a NAME rather than an ' +
      "address — landmarks, venues, businesses, and named public spaces: a station, a museum, a " +
      'restaurant, a park, a square, a bridge. "place" for postal addresses and administrative ' +
      "geographies: a street address, a city, a neighbourhood, a postcode, a region. " +
      'The test is how you would find it on a map: "Damrak 1, Amsterdam" is an address ("place"), ' +
      '"Dam Square" is a named landmark ("poi") even though a square sounds geographic. ' +
      "Getting this wrong is not harmless — the address geocoder has no entry for a landmark and " +
      "will fuzzy-match a street name somewhere else entirely."
  );

export const locationInputSchema = z.union([
  z.object({
    query: z.string().describe('Place name or address to resolve, e.g. "Amsterdam Centraal".'),
    queryAs: queryAsSchema,
  }),
  z.object({
    position: coordinateSchema.describe(
      "Explicit [longitude, latitude] — GeoJSON order, longitude FIRST. Use when you already " +
        "have coordinates, e.g. from a reverse-geocode result. lng in [-180, 180], lat in [-90, 90]."
    ),
  }),
  z.object({
    dataset_id: z
      .string()
      .describe(
        "A dataset_id from an earlier tool response, to reuse a place you already found instead of " +
          "searching for it again."
      ),
    featureIndex: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Which feature in that dataset to use (0-based, default 0). Call " +
          "tomtom-describe-dataset to see what the dataset holds."
      ),
  }),
]);

export type LocationInput = z.infer<typeof locationInputSchema>;

/** A resolved location: a position plus a human-readable name for reporting. */
export interface ResolvedLocation {
  position: Position;
  name: string;
  /** The original query text, when the input was resolved from text. */
  query?: string;
}

/** Pulls `[lng, lat]` out of a GeoJSON feature, whatever its geometry. */
const positionOf = (feature: unknown): Position | undefined => {
  const geometry = (feature as { geometry?: { type?: string; coordinates?: unknown } })?.geometry;
  const coords = geometry?.coordinates;
  if (!Array.isArray(coords)) return undefined;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") return coords as Position;
  // A line or polygon: take its first vertex rather than failing. Callers that
  // need a centroid can compute one in analyse-data.
  const first = coords.flat(3).slice(0, 2);
  return first.length === 2 && typeof first[0] === "number" ? (first as Position) : undefined;
};

/**
 * Resolves one {@link LocationInput} to a position.
 *
 * @throws IncorrectError when the name matches nothing in the chosen index.
 */
export async function resolveLocationInput(input: LocationInput): Promise<ResolvedLocation> {
  if ("position" in input) {
    return { position: input.position as Position, name: input.position.join(", ") };
  }

  if ("dataset_id" in input) {
    const { dataset_id, featureIndex = 0 } = input;
    const { features } = extractFeatures(requireDataset(dataset_id).data);
    const feature = features[featureIndex];
    if (!feature) {
      throw new IncorrectError(
        "The dataset has no feature at that index. Call tomtom-describe-dataset to see what is in it.",
        { dataset_id, featureIndex, featureCount: features.length }
      );
    }
    const position = positionOf(feature);
    if (!position) {
      throw new IncorrectError("The dataset feature has no usable coordinates.", {
        dataset_id,
        featureIndex,
      });
    }
    return { position, name: placeName(feature as Place) ?? `${dataset_id}[${featureIndex}]` };
  }

  // Text — the variant that removes the geocode hop. `queryAs` picks the index:
  // a POI search for venues, a geocode for addresses and geographies.
  const { query, queryAs } = input;
  const response =
    queryAs === "poi"
      ? await poiSearch(query, { limit: 1 })
      : await geocodeAddress(query, { limit: 1 });
  const feature = response.features[0];
  if (!feature) {
    throw new IncorrectError(
      queryAs === "poi"
        ? 'Could not resolve the query as a POI. Try queryAs: "place" if it is an address or an area rather than a venue.'
        : 'Could not resolve the query as a place. Try queryAs: "poi" if it is a venue or landmark rather than an address.',
      { query, queryAs }
    );
  }
  return {
    position: feature.geometry.coordinates,
    name: placeName(feature) ?? query,
    query,
  };
}

/**
 * Resolves an ordered list, reporting the first failure with its position.
 *
 * Sequential rather than parallel: a failure on waypoint 2 of 5 should not have
 * already spent three more geocodes, and route waypoint order is small enough
 * that the latency is not worth the wasted calls.
 *
 * @throws IncorrectError naming which input (1-based) failed to resolve.
 */
export async function resolveLocationInputs(
  inputs: readonly LocationInput[],
  label = "location"
): Promise<ResolvedLocation[]> {
  const resolved: ResolvedLocation[] = [];
  for (const [index, input] of inputs.entries()) {
    try {
      resolved.push(await resolveLocationInput(input));
    } catch (error) {
      if (!(error instanceof IncorrectError)) throw error;
      throw new IncorrectError(error.message, {
        ...error.data,
        failedInput: `${label} ${index + 1} of ${inputs.length}`,
      });
    }
  }
  return resolved;
}
