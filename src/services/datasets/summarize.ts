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
 * Dataset summarisation — describing held data without shipping it.
 *
 * Generalised from `computeSummary` in the BYOD data-viz tool, which was already
 * doing this for one kind. That function is the seed of the idea: the data-viz
 * tool never returns its GeoJSON, only a summary plus a handle, and it is the one
 * tool that stays useful on a 100k-feature input.
 *
 * A summary has to answer a question a trimmed dump cannot: **what could I write
 * code against?** So per property it reports the dotted path, its type, how often
 * it is present, and how many distinct values it takes — and when a property is a
 * low-cardinality enum it inlines the values outright. That last detail is what
 * lets a model write `c.currentType === "DCFast"` correctly first time instead of
 * guessing at a casing convention.
 */

import type { BBox } from "@tomtom-org/maps-sdk/core";
import type { ToolDataKind } from "../../tools/shared/tool-entry";

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

/** A profiled property of a dataset's features. */
export interface PropertyProfile {
  /** JS type(s) seen at this path, e.g. `"string"`, `"number"`, `"string|null"`. */
  type: string;
  /** How many of the scanned features had a non-`undefined` value here. */
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
  kind: ToolDataKind | "unknown";
  /** Exact feature count — never sampled. */
  count: number;
  geometryTypes: string[];
  bbox: BBox | null;
  /** Property paths → profile. Dotted, with `[]` marking an array hop. */
  properties: Record<string, PropertyProfile>;
  /** How many features the property scan actually inspected. */
  sampledFrom: number;
  /** Top-level keys of the response envelope, minus the feature container. */
  envelopeKeys?: string[];
  /** Whole, untrimmed features — the shape a code author needs to see. */
  sample: unknown[];
}

interface MinimalFeature {
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: Record<string, unknown> | null;
  [key: string]: unknown;
}

/**
 * Pulls the feature list out of whichever response shape a tool produced.
 *
 * The tools return four different envelopes for what is conceptually the same
 * thing, which is exactly the sort of inconsistency a summary has to absorb so
 * callers don't each re-derive it.
 */
function extractFeatures(data: unknown): { features: MinimalFeature[]; envelopeKeys: string[] } {
  if (!data || typeof data !== "object") return { features: [], envelopeKeys: [] };
  const obj = data as Record<string, unknown>;

  // GeoJSON FeatureCollection — search, routing, ranges.
  if (Array.isArray(obj.features)) {
    return {
      features: obj.features as MinimalFeature[],
      envelopeKeys: Object.keys(obj).filter((k) => k !== "features"),
    };
  }

  // Traffic: `{ incidents: [...] }`, itself GeoJSON features.
  if (Array.isArray(obj.incidents)) {
    return {
      features: obj.incidents as MinimalFeature[],
      envelopeKeys: Object.keys(obj).filter((k) => k !== "incidents"),
    };
  }

  // A single Feature — reverse geocode, single reachable range.
  if (obj.type === "Feature") {
    return { features: [obj as MinimalFeature], envelopeKeys: [] };
  }

  // Anything else (e.g. a dynamic-map state object) has no features; its
  // top-level keys are still worth reporting.
  return { features: [], envelopeKeys: Object.keys(obj) };
}

/** Walks every coordinate to find the true extent. */
function computeBbox(features: MinimalFeature[]): BBox | null {
  let minLng = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let found = false;

  const walk = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      found = true;
      const [lng, lat] = coords as number[];
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const c of coords) walk(c);
  };

  for (const feature of features) walk(feature.geometry?.coordinates);
  return found ? [minLng, minLat, maxLng, maxLat] : null;
}

/** Mutable accumulator behind a {@link PropertyProfile}. */
interface Accumulator {
  types: Set<string>;
  present: number;
  values: Set<unknown>;
  overflowed: boolean;
}

const typeOf = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
};

const record = (acc: Map<string, Accumulator>, path: string, value: unknown): void => {
  let entry = acc.get(path);
  if (!entry) {
    entry = { types: new Set(), present: 0, values: new Set(), overflowed: false };
    acc.set(path, entry);
  }
  entry.present += 1;
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
  acc: Map<string, Accumulator>,
  value: unknown,
  path: string,
  depth: number
): void {
  if (value === undefined) return;

  if (Array.isArray(value)) {
    record(acc, path, value);
    if (depth >= MAX_DEPTH) return;
    for (const item of value) walkProperties(acc, item, `${path}[]`, depth + 1);
    return;
  }

  if (value !== null && typeof value === "object") {
    if (depth >= MAX_DEPTH) {
      record(acc, path, value);
      return;
    }
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      walkProperties(acc, nested, path ? `${path}.${key}` : key, depth + 1);
    }
    return;
  }

  record(acc, path, value);
}

function toProfiles(acc: Map<string, Accumulator>): Record<string, PropertyProfile> {
  const profiles: Record<string, PropertyProfile> = {};
  // Sorted so two summaries of the same shape are diffable.
  for (const path of [...acc.keys()].sort()) {
    const entry = acc.get(path) as Accumulator;
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
 * Builds a {@link DatasetSummary} for a raw tool response.
 *
 * @param data  The UNTRIMMED response — summarising a trimmed one would describe
 *              a shape nothing can be queried against.
 * @param kind  What the producing tool declared it makes.
 * @param sampleSize How many whole features to include verbatim.
 */
export function summarize(
  data: unknown,
  kind: ToolDataKind | "unknown" = "unknown",
  sampleSize = 2
): DatasetSummary {
  const { features, envelopeKeys } = extractFeatures(data);

  const scanned = features.slice(0, PROPERTY_SCAN_LIMIT);
  const acc = new Map<string, Accumulator>();
  const geometryTypes = new Set<string>();

  for (const feature of scanned) {
    if (feature.geometry?.type) geometryTypes.add(feature.geometry.type);
    // Incidents carry their fields flat (post-trim) or under `properties`
    // (GeoJSON) — walk whichever exists so both shapes profile the same way.
    walkProperties(acc, feature.properties ?? undefined, "", 0);
  }

  return {
    kind,
    count: features.length,
    geometryTypes: [...geometryTypes].sort(),
    bbox: computeBbox(features),
    properties: toProfiles(acc),
    sampledFrom: scanned.length,
    ...(envelopeKeys.length && { envelopeKeys }),
    sample: features.slice(0, Math.max(0, sampleSize)),
  };
}
