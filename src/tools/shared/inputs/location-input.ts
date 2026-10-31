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
 * `locationInput` — the two ways to name a place, accepted everywhere
 * (*Location input* in CONTEXT.md). A place NAME resolves here, so "route from
 * Amsterdam Centraal to the Rijksmuseum" is one call with no geocode hops.
 */

import type { Position } from "geojson";
import { z } from "zod";
import { coordinateSchema } from "../../../schemas/routing/common";
import { IncorrectError } from "../../../types/types";
import { orJsonString } from "./json-string";
import { normaliseName } from "./place-names";
import { resolvePlaceName } from "./resolve-where";

export const locationInputSchema = orJsonString(
  z.union(
    [
      z.object({
        query: z
          .string()
          .describe(
            'Place name or address to resolve, e.g. "Amsterdam Centraal" or "Damrak 1, ' +
              'Amsterdam". Qualify a name several places share: "Paris, France".'
          ),
      }),
      z.object({
        position: coordinateSchema.describe(
          "Explicit [longitude, latitude] — GeoJSON order, longitude FIRST. Use when you already " +
            "have coordinates, e.g. from an earlier result: it skips looking the name up again. " +
            "lng in [-180, 180], lat in [-90, 90]."
        ),
      }),
    ],
    {
      error: (issue) =>
        issue.code === "invalid_union"
          ? "A location is an object: { query } or { position: [longitude, latitude] }."
          : undefined,
    }
  )
);

export type LocationInput = z.infer<typeof locationInputSchema>;

/** What makes two inputs the same place before either resolves: its name, or its position. */
export const locationKey = (input: LocationInput): string =>
  "position" in input ? input.position.join(",") : normaliseName(input.query);

/** An input as the user gave it, for reporting. */
export const locationLabel = (input: LocationInput): string =>
  "position" in input ? input.position.join(", ") : input.query;

/** A resolved location: a position plus a human-readable name for reporting. */
export interface ResolvedLocation {
  position: Position;
  name: string;
}

/**
 * Resolves one {@link LocationInput} to a position.
 *
 * @throws IncorrectError when the name matches nothing.
 */
export async function resolveLocationInput(input: LocationInput): Promise<ResolvedLocation> {
  if ("position" in input) {
    return { position: input.position as Position, name: locationLabel(input) };
  }

  // Text — the variant that removes the geocode hop.
  const { query } = input;
  const resolved = await resolvePlaceName(query);
  if (!resolved) {
    throw new IncorrectError(
      'Could not resolve the query to a place. Qualify it with its city or country ("Damrak 1, ' +
        'Amsterdam"), or give its { position }.',
      { query }
    );
  }
  return { position: resolved.position, name: resolved.label };
}

/**
 * Resolves an ordered list, reporting the first failure with its position. A place
 * the list names twice, such as a round trip's origin and destination, resolves once.
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
  const byKey = new Map<string, ResolvedLocation>();
  for (const [index, input] of inputs.entries()) {
    try {
      const key = locationKey(input);
      const location = byKey.get(key) ?? (await resolveLocationInput(input));
      byKey.set(key, location);
      resolved.push(location);
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
