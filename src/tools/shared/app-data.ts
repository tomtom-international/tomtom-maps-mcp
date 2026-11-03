/*
 * Copyright (C) 2026 TomTom Navigation B.V.
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
 */

// App data in the tool result (CONTEXT.md, App data; docs/adr/0009-app-data-in-the-tool-result.md).

import { promisify } from "node:util";
import { gzip } from "node:zlib";
import type { Feature, LineString, Position } from "geojson";
import { POINT_INDEX_KEYS } from "./geometry-response";
import { capPaths, ROUNDING_ERROR_M, roundPosition } from "./simplify";

/**
 * Claude keeps a tool result longer than about 150,000 characters out of the
 * conversation, and its app then never receives it.
 */
export const MAX_INLINE_RESULT_CHARS = 120_000;

/** gzip shrinks this JSON three- to fivefold, so ten times the room left cannot fit. */
const MAX_GZIP_RATIO = 10;

/** Simplification passes before the data counts as too large for the result. */
const MAX_FIT_PASSES = 6;

const gzipAsync = promisify(gzip);

/** What the server did with a result's app data, for the logs. */
export interface AppDataReport {
  /** "inline" in the result's `_meta`, or "too_large" for it, even simplified. */
  delivery: "inline" | "too_large";
  json_chars: number;
  inline_chars?: number;
  /** Present when route lines were rounded or simplified to fit. */
  simplification?: { original_points: number; points: number; max_error_m: number };
}

/** A tool result's full app data, kept beside the result for the server's own use. */
export interface AppData {
  data: unknown;
  report: AppDataReport;
}

/** Key of the AppData on a tool result; a symbol, so it is never serialized. */
export const APP_DATA = Symbol("app data");

export type WithAppData = { [APP_DATA]?: AppData };

/**
 * `data` as base64 of its gzipped JSON in at most `room` characters. Unless `exact`,
 * route lines that don't fit are rounded to 1 m, then simplified until they do,
 * keeping every vertex a property points at (a section's start and end, a progress
 * point) and renumbering those indices. Without `inline`, the data doesn't fit.
 */
export async function encodeAppData(
  data: unknown,
  room: number,
  exact: boolean
): Promise<{ inline?: string; report: AppDataReport }> {
  const json = JSON.stringify(data);
  const report: AppDataReport = { delivery: "too_large", json_chars: json.length };
  const inlined = (inline: string, simplification?: AppDataReport["simplification"]) => ({
    inline,
    report: { ...report, delivery: "inline" as const, inline_chars: inline.length, simplification },
  });

  if (json.length <= room * MAX_GZIP_RATIO) {
    const inline = await gzipBase64(json);
    if (inline.length <= room) return inlined(inline);
  }
  if (exact) return { report };

  const copy: unknown = JSON.parse(json);
  const lines = routeLines(copy);
  if (lines.length === 0) return { report };
  const total = lines.reduce((sum, line) => sum + line.rounded.length, 0);

  for (const line of lines) line.feature.geometry.coordinates = line.rounded;
  const rounded = await gzipBase64(JSON.stringify(copy));
  if (rounded.length <= room) {
    return inlined(rounded, {
      original_points: total,
      points: total,
      max_error_m: Math.ceil(ROUNDING_ERROR_M),
    });
  }

  const fitted = await simplifyToFit(copy, lines, room, rounded.length);
  return fitted ? inlined(fitted.inline, fitted.simplification) : { report };
}

/**
 * `data` encoded in at most `room` characters once its `lines` are simplified,
 * shrinking their vertex cap by how far the last encoding overshot.
 */
async function simplifyToFit(
  data: unknown,
  lines: RouteLine[],
  room: number,
  encodedLength: number
): Promise<{ inline: string; simplification: AppDataReport["simplification"] } | undefined> {
  const paths = lines.map((line) => line.rounded);
  const fixed = lines.map((line) => line.fixed());
  let cap = paths.reduce((sum, path) => sum + path.length, 0);
  let length = encodedLength;
  for (let pass = 0; pass < MAX_FIT_PASSES; pass++) {
    cap = Math.floor((cap * room * 0.9) / length);
    if (cap < 2 * lines.length) return undefined;
    const { simplification, indices } = capPaths(paths, { rings: false, cap, fixed });
    if (!indices) return undefined;
    for (const [index, line] of lines.entries()) line.keep(indices[index]);
    const inline = await gzipBase64(JSON.stringify(data));
    if (inline.length <= room) return { inline, simplification };
    length = inline.length;
  }
  return undefined;
}

async function gzipBase64(json: string): Promise<string> {
  return (await gzipAsync(json)).toString("base64");
}

type LineFeature = Feature<LineString>;

interface IndexRef {
  holder: Record<string, unknown>;
  key: string;
  index: number;
}

/** A LineString feature of the app data, with the vertex indices its properties hold. */
class RouteLine {
  readonly rounded: Position[];
  private readonly refs: IndexRef[] = [];

  constructor(readonly feature: LineFeature) {
    this.rounded = feature.geometry.coordinates.map(roundPosition);
    collectIndexRefs(feature.properties, this.refs);
  }

  fixed(): number[] {
    return this.refs.map((ref) => ref.index);
  }

  /** Keeps only the vertices at `indices` (ascending) and renumbers the properties' indices. */
  keep(indices: number[]): void {
    const renumbered = new Map(indices.map((index, position) => [index, position]));
    this.feature.geometry.coordinates = indices.map((index) => this.rounded[index]);
    for (const ref of this.refs) {
      const position = renumbered.get(ref.index);
      if (position !== undefined) ref.holder[ref.key] = position;
    }
  }
}

function routeLines(node: unknown, lines: RouteLine[] = []): RouteLine[] {
  if (!node || typeof node !== "object") return lines;
  if (isLineFeature(node)) {
    lines.push(new RouteLine(node));
    return lines;
  }
  for (const value of Object.values(node)) routeLines(value, lines);
  return lines;
}

function isLineFeature(node: object): node is LineFeature {
  const feature = node as Partial<LineFeature>;
  return (
    feature.type === "Feature" &&
    feature.geometry?.type === "LineString" &&
    Array.isArray(feature.geometry.coordinates)
  );
}

/** Every number under one of the POINT_INDEX_KEYS, which `geometry` responses drop. */
function collectIndexRefs(node: unknown, refs: IndexRef[]): void {
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "number" && POINT_INDEX_KEYS.has(key)) {
      refs.push({ holder: node as Record<string, unknown>, key, index: value });
    } else {
      collectIndexRefs(value, refs);
    }
  }
}
