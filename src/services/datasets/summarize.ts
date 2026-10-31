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
 * Dataset summarisation — describing a dataset to the model without shipping it.
 *
 * The data-viz tool returns the caller's GeoJSON to its app only; the model gets
 * this summary, which stays small on a 100k-feature input.
 *
 * A summary has to answer a question a trimmed dump cannot: **what could I write
 * code against?** So per property it reports the dotted path, its type, how often
 * it is present, and how many distinct values it takes — and when a property is a
 * low-cardinality enum it inlines the values outright. That last detail is what
 * lets a model write `c.currentType === "DCFast"` correctly first time instead of
 * guessing at a casing convention.
 */

import type { BBox } from "@tomtom-org/maps-sdk/core";

/**
 * How many features to walk when profiling properties. Counting is exact; the
 * property scan is sampled, because a BYOD upload may hold 100k features and a
 * full walk would cost more than the tool call that produced it. `sampledFrom`
 * on the summary reports what was actually inspected — a summary that silently
 * described 500 of 100k features would be worse than useless.
 */
const PROPERTY_SCAN_LIMIT = 500;

/** Distinct values tracked per property before giving up on exactness. */
const DISTINCT_CAP = 64;

/** At or below this many distinct values, the values themselves are inlined. */
const INLINE_VALUES_MAX = 12;

/** How deep into nested objects the property walk goes. */
const MAX_DEPTH = 4;

/** The most property paths profiled; a route passed in whole has thousands. */
const PROFILED_PATHS_MAX = 200;

/** A sampled string or array past these sizes is cut, so the sample stays small too. */
const SAMPLE_STRING_MAX = 200;
const SAMPLE_ARRAY_MAX = 5;

/** A profiled property of a dataset's features. */
export interface PropertyProfile {
  /** JS type(s) seen at this path, e.g. `"string"`, `"number"`, `"string|null"`. */
  type: string;
  /** How many of the scanned features had a non-`undefined` value here, counted once per feature. */
  present: number;
  /** Distinct values seen, capped at {@link DISTINCT_CAP}. */
  distinct: number;
  /** True when `distinct` hit the cap and is therefore a floor, not a count. */
  distinctTruncated?: boolean;
  /**
   * The actual values, inlined when there are few enough. This is the field that
   * makes generated code correct on the first attempt.
   */
  values?: unknown[];
}

export interface DatasetSummary {
  /** Exact feature count — never sampled. */
  count: number;
  geometryTypes: string[];
  bbox: BBox | null;
  /** Property paths → profile. Dotted, with `[]` marking an array hop. */
  properties: Record<string, PropertyProfile>;
  /** How many paths past {@link PROFILED_PATHS_MAX} were left out of `properties`. */
  propertiesOmitted?: number;
  /** How many features the property scan actually inspected. */
  sampledFrom: number;
  /**
   * The properties of the first features, without their geometry; null for a feature
   * without any. Long strings and arrays are cut, and deep objects stop at "…".
   */
  sample: (Record<string, unknown> | null)[];
}

/** What a summary reads of a feature: the caller's GeoJSON is not validated beyond this. */
interface MinimalFeature {
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: Record<string, unknown> | null;
}

/**
 * Walks every coordinate to find the true extent. The caller's GeoJSON is not
 * validated, so any nesting of numeric pairs counts, where the SDK's
 * `bboxFromGeoJSON` throws or returns nulls for coordinates its type does not expect.
 */
function computeBbox(features: readonly MinimalFeature[]): BBox | null {
  const bbox: BBox = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  const extend = ([longitude, latitude]: number[]): void => {
    bbox[0] = Math.min(bbox[0], longitude);
    bbox[1] = Math.min(bbox[1], latitude);
    bbox[2] = Math.max(bbox[2], longitude);
    bbox[3] = Math.max(bbox[3], latitude);
  };
  const walk = (coordinates: unknown): void => {
    if (!Array.isArray(coordinates)) return;
    if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
      extend(coordinates);
    } else {
      for (const nested of coordinates) walk(nested);
    }
  };

  for (const feature of features) walk(feature.geometry?.coordinates);
  return Number.isFinite(bbox[0]) ? bbox : null;
}

/** Mutable accumulator behind a {@link PropertyProfile}. */
interface Accumulator {
  types: Set<string>;
  present: number;
  /** The last feature counted in `present`, so an array's elements count it once. */
  lastFeature: number;
  values: Set<unknown>;
  overflowed: boolean;
}

const typeOf = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
};

const recordValue = (
  accumulators: Map<string, Accumulator>,
  path: string,
  value: unknown,
  feature: number
): void => {
  let entry = accumulators.get(path);
  if (!entry) {
    entry = { types: new Set(), present: 0, lastFeature: -1, values: new Set(), overflowed: false };
    accumulators.set(path, entry);
  }
  if (entry.lastFeature !== feature) {
    entry.present += 1;
    entry.lastFeature = feature;
  }
  entry.types.add(typeOf(value));
  // Only primitives are worth tracking as values; an object's identity says
  // nothing about cardinality.
  if (value === null || typeof value !== "object") {
    if (entry.values.size < DISTINCT_CAP) entry.values.add(value);
    else entry.overflowed = true;
  }
};

/**
 * Records every leaf under `value` at dotted `path`.
 *
 * Arrays are marked with a `[]` hop and their ELEMENTS are walked, so
 * `chargingPark.connectors[].currentType` describes the connector field rather
 * than the array — which is the path a code author actually needs.
 */
function walkProperties(
  accumulators: Map<string, Accumulator>,
  value: unknown,
  path: string,
  depth: number,
  feature: number
): void {
  if (value === undefined) return;

  if (Array.isArray(value)) {
    recordValue(accumulators, path, value, feature);
    if (depth >= MAX_DEPTH) return;
    for (const item of value) walkProperties(accumulators, item, `${path}[]`, depth + 1, feature);
    return;
  }

  if (value !== null && typeof value === "object") {
    if (depth >= MAX_DEPTH) {
      recordValue(accumulators, path, value, feature);
      return;
    }
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      walkProperties(accumulators, nested, path ? `${path}.${key}` : key, depth + 1, feature);
    }
    return;
  }

  recordValue(accumulators, path, value, feature);
}

/** A sampled value cut to size: long strings and arrays shortened, deep objects elided. */
function sampleOf(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return value.length > SAMPLE_STRING_MAX ? `${value.slice(0, SAMPLE_STRING_MAX)}…` : value;
  }
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "…";
  if (Array.isArray(value)) {
    const kept = value.slice(0, SAMPLE_ARRAY_MAX).map((item) => sampleOf(item, depth + 1));
    return value.length > SAMPLE_ARRAY_MAX
      ? [...kept, `… ${value.length - SAMPLE_ARRAY_MAX} more`]
      : kept;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, sampleOf(nested, depth + 1)])
  );
}

function toProfiles(accumulators: Map<string, Accumulator>): Record<string, PropertyProfile> {
  const profiles: Record<string, PropertyProfile> = {};
  // Sorted so two summaries of the same shape are diffable.
  for (const path of [...accumulators.keys()].sort().slice(0, PROFILED_PATHS_MAX)) {
    const entry = accumulators.get(path) as Accumulator;
    const profile: PropertyProfile = {
      type: [...entry.types].sort().join("|"),
      present: entry.present,
      distinct: entry.values.size,
    };
    if (entry.overflowed) profile.distinctTruncated = true;
    // Inline the vocabulary only when it is COMPLETE and short — a truncated
    // list would read as the full set and mislead generated code.
    if (!entry.overflowed && entry.values.size > 0 && entry.values.size <= INLINE_VALUES_MAX) {
      profile.values = [...entry.values].sort((a, b) => String(a).localeCompare(String(b)));
    }
    profiles[path] = profile;
  }
  return profiles;
}

/**
 * Builds a {@link DatasetSummary} for the caller's GeoJSON, normalised to a
 * FeatureCollection (`normalizeToFeatureCollection`).
 *
 * @param sampleSize How many features' properties to include verbatim.
 */
export function summarize(
  { features }: { features: readonly MinimalFeature[] },
  sampleSize = 2
): DatasetSummary {
  const scanned = features.slice(0, PROPERTY_SCAN_LIMIT);
  const accumulators = new Map<string, Accumulator>();
  for (const [index, feature] of scanned.entries()) {
    walkProperties(accumulators, feature.properties ?? undefined, "", 0, index);
  }
  const geometryTypes = new Set(features.flatMap((feature) => feature.geometry?.type ?? []));

  return {
    count: features.length,
    geometryTypes: [...geometryTypes].sort(),
    bbox: computeBbox(features),
    properties: toProfiles(accumulators),
    ...(accumulators.size > PROFILED_PATHS_MAX && {
      propertiesOmitted: accumulators.size - PROFILED_PATHS_MAX,
    }),
    sampledFrom: scanned.length,
    sample: features
      .slice(0, Math.max(0, sampleSize))
      .map((feature) =>
        feature.properties ? (sampleOf(feature.properties) as Record<string, unknown>) : null
      ),
  };
}
