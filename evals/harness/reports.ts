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
 * What the sweep scripts and their roll-ups share: reading archived reports back,
 * the statistics taken over them, and the list-valued environment variables that
 * select what runs.
 *
 * Node built-ins only, so a `tsx` script can import it without loading a model
 * provider or the server.
 */

import fs from "node:fs";
import path from "node:path";
import type { CapabilityReport } from "../capability/judge";

/** A sweep's directory name: when it started, safe in a path. */
export const sweepId = (startedAt = new Date()): string =>
  startedAt.toISOString().replace(/[:.]/g, "-");

/** Millisecond mtime, or null when the file does not exist yet. */
export const stampOf = (file: string): number | null =>
  fs.existsSync(file) ? fs.statSync(file).mtimeMs : null;

/** How many tasks a just-written report failed to score; 0 when it cannot be read. */
export const notMeasuredIn = (reportFile: string): number => {
  try {
    return JSON.parse(fs.readFileSync(reportFile, "utf-8")).summary?.notMeasured ?? 0;
  } catch {
    return 0;
  }
};

/** Median of a list. Even counts average the two middle values. */
export const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Lowest and highest of a list. */
export const rangeOf = (values: readonly number[]): [number, number] => [
  Math.min(...values),
  Math.max(...values),
];

/** `8–13`, or `8` when every run agreed. */
export const formatRange = ([low, high]: readonly [number, number]): string =>
  low === high ? `${low}` : `${low}–${high}`;

/** Every `report.<id>.<run>.json` in `dir`, in run order (run 10 after run 9). */
export const readReports = (dir: string, id: string): CapabilityReport[] =>
  fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(`report.${id}.`) && name.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8")) as CapabilityReport);

/** A comma-separated list, each item trimmed, blanks dropped. */
export const splitList = (list: string): string[] =>
  list
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/** A comma-separated environment variable as a list; `fallback` when it is unset. */
export const envList = (name: string, fallback = ""): string[] =>
  splitList(process.env[name] ?? fallback);
