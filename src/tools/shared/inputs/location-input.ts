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
 * Amsterdam Centraal to the Rijksmuseum" is one call with no geocode hops. A place
 * an earlier result holds is `{ dataset_id, featureIndex? }`, so it is not searched
 * for again.
 */

import type { Place, Routes } from "@tomtom-org/maps-sdk/core";
import * as turf from "@turf/turf";
import type { Feature, Position } from "geojson";
import type { LocationInput } from "../../../schemas/shared/locationInput";
import { requireDataset } from "../../../services/datasets/dataset-store";
import { getRoute } from "../../../services/routing/routingService";
import { IncorrectError } from "../../../types/types";
import { normaliseName, placeName } from "./place-names";
import { resolvePlaceName } from "./resolve-where";
import type { Drive } from "./route-stretch";

/** An input as the user gave it, for reporting. */
export const locationLabel = (input: LocationInput): string => {
  if ("position" in input) return input.position.join(", ");
  if ("dataset_id" in input) return `${input.dataset_id}[${input.featureIndex ?? 0}]`;
  return input.query;
};

/**
 * What makes two inputs the same place before either resolves: its name, its
 * position, or its dataset feature.
 */
export const locationKey = (input: LocationInput): string =>
  "query" in input ? normaliseName(input.query) : locationLabel(input);

/** A resolved location: a position plus a human-readable name for reporting. */
export interface ResolvedLocation {
  position: Position;
  name: string;
}

/** A feature's point: its own for a Point, else its first vertex. */
const positionOf = (feature: Feature): Position | undefined => {
  if (!feature.geometry) return undefined;
  const [first] = turf.coordAll(feature);
  return first && [first[0], first[1]];
};

/** The place `featureIndex` of a stored dataset names. */
function resolveDatasetFeature(datasetId: string, featureIndex = 0): ResolvedLocation {
  const { features } = requireDataset(datasetId);
  const feature = features[featureIndex];
  if (!feature) {
    throw new IncorrectError(
      "The dataset has no feature at that index. Call tomtom-describe-dataset to see what is in it.",
      { dataset_id: datasetId, featureIndex, featureCount: features.length }
    );
  }
  const position = positionOf(feature);
  if (!position) {
    throw new IncorrectError(
      "The dataset feature has no coordinates. Pick another `featureIndex`, or name the place.",
      { dataset_id: datasetId, featureIndex }
    );
  }
  return {
    position,
    name:
      (feature.properties && placeName(feature as unknown as Place)) ??
      `${datasetId}[${featureIndex}]`,
  };
}

/**
 * Resolves one {@link LocationInput} to a position.
 *
 * @throws IncorrectError when the name matches nothing, or the dataset holds no such place.
 */
export async function resolveLocationInput(input: LocationInput): Promise<ResolvedLocation> {
  if ("position" in input) {
    return { position: input.position, name: locationLabel(input) };
  }
  if ("dataset_id" in input) return resolveDatasetFeature(input.dataset_id, input.featureIndex);

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

/**
 * The drive through `locations`: its routes and the first of them, and its stops as they resolved,
 * spelled "A → B" for reporting what was searched.
 *
 * @throws IncorrectError with `noRoute` when no driving route connects them.
 */
export async function planDrive(locations: readonly LocationInput[], noRoute: string) {
  const stops = await resolveLocationInputs(locations, "location");
  const routes = await getRoute(stops.map(({ position }) => position));
  const [route] = routes.features;
  const names = stops.map(({ name }) => name);
  if (!route) throw new IncorrectError(noRoute, { locations: names });
  return { routes, route, stops: names.join(" → ") };
}

/**
 * The drive a route mode follows: planned through `locations`, or held in `dataset_id`. A route
 * tomtom-plan-route stored keeps its distances, times and sections; any other line, a derived cut
 * of a route included, has only its length, since a route's progress indexes no longer fit it.
 * `routes` is there for a planned drive only.
 *
 * @throws IncorrectError when both or neither are given, the dataset's first feature is not a
 *   line, or no driving route connects the locations.
 */
export async function resolveDrive(
  where: { locations?: readonly LocationInput[]; dataset_id?: string },
  noRoute: string
): Promise<{ drive: Drive; routes?: Routes; label: string }> {
  const { locations, dataset_id } = where;
  const oneSource = "Give the drive as either `locations` or a route's `dataset_id`.";
  if (!dataset_id) {
    if (!locations) throw new IncorrectError(oneSource);
    const { routes, route, stops } = await planDrive(locations, noRoute);
    return { drive: route, routes, label: `the drive ${stops}` };
  }
  if (locations) throw new IncorrectError(oneSource);
  const { data, features, provenance } = requireDataset(dataset_id);
  const geometry = features[0]?.geometry;
  if (geometry?.type !== "LineString" || geometry.coordinates.length < 2) {
    throw new IncorrectError(
      "The dataset's first feature is not a line. Pass the `dataset_id` of a route " +
        "tomtom-plan-route planned, or of one tomtom-derive-datasets built with the line first.",
      { dataset_id }
    );
  }
  if (provenance.tool === "tomtom-plan-route") {
    const routes = data as Routes;
    return { drive: routes.features[0], routes, label: `the route in ${dataset_id}` };
  }
  const lengthInMeters = turf.length(turf.lineString(geometry.coordinates), { units: "meters" });
  return {
    drive: { geometry, properties: { summary: { lengthInMeters }, sections: {} } },
    label: `the line in ${dataset_id}`,
  };
}
