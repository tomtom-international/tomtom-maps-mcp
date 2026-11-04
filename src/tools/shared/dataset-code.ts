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
 * Running model-written code over held datasets, for `tomtom-analyse-datasets` and
 * `tomtom-derive-datasets`: the datasets resolved, the sandbox run, and the check
 * that a result reads like data rather than like a wrong property path.
 */

import * as turf from "@turf/turf";
import type { Feature } from "geojson";
import * as h3 from "h3-js";
import { type Dataset, requireDataset } from "../../services/datasets/dataset-store";
import { IncorrectError } from "../../types/types";
import { errorResult } from "./response-trimmer";
import { HELPER_NAMES } from "./sandbox/helpers";
import { processSandboxExecutor } from "./sandbox/process-executor";
import { runSandboxedFn } from "./sandbox/sandbox-code";
import type { ToolResponse } from "./tool-entry";

/**
 * The injected parameter names, in the order the sandbox receives them.
 *
 * `turf` and `h3` are listed because the body needs them in scope, but their
 * values are supplied INSIDE the child process — function namespaces cannot cross
 * its JSON boundary. The imports above exist so this module still declares its
 * real dependencies. `features` and `byDataset` are built in the child from
 * `datasets` ({@link FROM_DATASETS}), so each feature crosses the boundary once.
 */
const SANDBOX_PARAMS = [
  "datasets",
  "features",
  "byDataset",
  "turf",
  "h3",
  ...HELPER_NAMES,
] as const;

/** Fills `byDataset` and `features` from `datasets`, sharing their feature objects. */
const FROM_DATASETS =
  "byDataset = Object.fromEntries(Object.entries(datasets).map(([id, dataset]) => " +
  "[id, dataset?.features ?? []])); features = Object.values(byDataset).flat();";

/** What a run read: each dataset, its producer and its size, so a result can be traced to its input. */
export interface DatasetsRead {
  datasets: { dataset_id: string; producedBy: string; features: number }[];
  totalFeatures: number;
}

/** A finished run: the code's value, what it read, and how long it took. */
export interface DatasetCodeRun {
  value: unknown;
  read: DatasetsRead;
  /** Every feature the code was given, across its datasets. */
  features: Feature[];
  elapsedMs: number;
}

/**
 * Runs `code` over the caller's datasets in the sandbox.
 *
 * @param verb How a failure names the run: "Analysis", "Derivation".
 * @returns The run, or the sandbox's error for the model to fix its code.
 * @throws IncorrectError when a dataset is unavailable, before any code runs.
 */
export async function runDatasetCode(
  datasetIds: readonly string[],
  code: string,
  verb: string
): Promise<DatasetCodeRun | { error: string }> {
  const resolved: Dataset[] = datasetIds.map(requireDataset);
  const datasets = Object.fromEntries(resolved.map(({ id, data }) => [id, data]));
  const features = resolved.flatMap((dataset) => dataset.features);

  const started = Date.now();
  const result = await runSandboxedFn(
    code,
    SANDBOX_PARAMS,
    // Every slot but `datasets` is filled inside the child; see SANDBOX_PARAMS.
    [datasets, undefined, undefined, turf, h3, ...HELPER_NAMES.map(() => undefined)],
    verb,
    processSandboxExecutor,
    FROM_DATASETS
  );
  if ("error" in result) return result;
  return {
    value: result.value,
    read: {
      datasets: resolved.map((dataset) => ({
        dataset_id: dataset.id,
        producedBy: dataset.provenance.tool,
        features: dataset.features.length,
      })),
      totalFeatures: features.length,
    },
    features,
    elapsedMs: Date.now() - started,
  };
}

/** Group keys a wrong property path produces. */
const NONSENSE_KEYS = new Set(["undefined", "null", "NaN", "[object Object]"]);

/**
 * What about a result suggests the code read the wrong paths: models measured on
 * the demanding corpus got back nulls, "[object Object]" or `undefined` group keys,
 * then told the user the data was missing. Empty for a plausible result.
 */
export function suspicionsIn(value: unknown): string[] {
  const leaves: unknown[] = [];
  const keys: string[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (depth > 8) return;
    if (Array.isArray(node)) for (const item of node) walk(item, depth + 1);
    else if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        keys.push(key);
        walk(child, depth + 1);
      }
    } else leaves.push(node);
  };
  walk(value, 0);

  const suspicions: string[] = [];
  if (leaves.some((leaf) => typeof leaf === "string" && leaf.includes("[object Object]"))) {
    suspicions.push('it contains "[object Object]", an object turned into a string');
  }
  const nonsense = keys.filter((key) => NONSENSE_KEYS.has(key));
  if (nonsense.length) suspicions.push(`it groups by ${[...new Set(nonsense)].join(", ")}`);
  const empty = (leaf: unknown) => leaf === null || leaf === undefined || Number.isNaN(leaf);
  if (leaves.length && leaves.every(empty)) suspicions.push("every value in it is null");
  return suspicions;
}

/** The error for a result that looks wrong, with what came back beside it. */
export const suspiciousResultError = (
  suspicions: readonly string[],
  result: Record<string, unknown>
): ToolResponse =>
  errorResult(
    new IncorrectError(
      `The code ran, but its result looks wrong: ${suspicions.join("; ")}. That usually ` +
        "means a property path doesn't match the data. Check the DATASET SHAPES, use the " +
        "place, route and incident helpers, or call tomtom-describe-dataset, then run it again.",
      result
    )
  );
