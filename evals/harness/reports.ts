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
 * What the run command and the report share: reading a sweep's reports back,
 * the statistics taken over them, and the list-valued environment variables that
 * select what runs.
 *
 * Node only, so a `tsx` script can import it without loading a model provider or
 * the server.
 */

import fs from "node:fs";
import path from "node:path";
import type { CapabilityReport } from "../capability/judge";
import { REPO_ROOT } from "./target";

/** Where every sweep keeps its reports, one directory each. */
export const SWEEPS_DIR = path.join(REPO_ROOT, "evals", "capability", "runs");

/** A sweep's directory name: when it started, safe in a path. */
export const sweepId = (startedAt = new Date()): string =>
  startedAt.toISOString().replace(/[:.]/g, "-");

/** Millisecond mtime, or null when the file does not exist yet. */
export const stampOf = (file: string): number | null =>
  fs.existsSync(file) ? fs.statSync(file).mtimeMs : null;

const readPartialReport = (reportFile: string): Partial<CapabilityReport> => {
  try {
    return JSON.parse(fs.readFileSync(reportFile, "utf-8"));
  } catch {
    return {};
  }
};

/** How many tasks a just-written report failed to score; 0 when it cannot be read. */
export const notMeasuredIn = (reportFile: string): number =>
  readPartialReport(reportFile).summary?.notMeasured ?? 0;

/** How many tasks a just-written report left unrun once `EVAL_MAX_TOKENS` was spent. */
export const unrunByBudgetIn = (reportFile: string): number =>
  readPartialReport(reportFile).budget?.unrun.length ?? 0;

/** Median of a list. Even counts average the two middle values. */
export const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** The spread of a metric over repeated runs, as the toolkit's `EvalNumericStats`. */
export interface NumericStats {
  min: number;
  max: number;
  mean: number;
  median: number;
}

/** {@link NumericStats} of a list; zeroes for an empty one. */
export const numericStats = (values: readonly number[]): NumericStats =>
  values.length
    ? {
        min: Math.min(...values),
        max: Math.max(...values),
        mean: values.reduce((sum, value) => sum + value, 0) / values.length,
        median: median(values),
      }
    : { min: 0, max: 0, mean: 0, median: 0 };

/** A number as the tables print it: thousands separated, at most one decimal. */
export const formatNumber = (value: number): string =>
  value.toLocaleString("en-GB", { maximumFractionDigits: 1 });

/** `+3`, `-1,200`, `0`: a difference with its direction. */
export const signed = (difference: number): string =>
  `${difference > 0 ? "+" : ""}${formatNumber(difference)}`;

/** The names of every `report.<id>.<run>.json` in `dir`, in run order (run 10 after run 9). */
export const reportFiles = (dir: string, id: string): string[] =>
  (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    .filter(
      (name) =>
        name.startsWith(`report.${id}.`) && /^\d+\.json$/.test(name.slice(`report.${id}.`.length))
    )
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

/** Every `report.<id>.<run>.json` in `dir`, in run order. */
export const readReports = (dir: string, id: string): CapabilityReport[] =>
  reportFiles(dir, id).map(
    (name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8")) as CapabilityReport
  );

/** A comma-separated list, each item trimmed, blanks dropped. */
export const splitList = (list: string): string[] =>
  list
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/** A comma-separated environment variable as a list; `fallback` when it is unset. */
export const envList = (name: string, fallback = ""): string[] =>
  splitList(process.env[name] ?? fallback);
