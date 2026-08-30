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
 * `tomtom-analyse-data` — code execution over server-held datasets.
 *
 * The point of the whole dataset track. A trimmed response can only answer
 * questions about what survived the trimming; this answers questions about the
 * whole result set by sending the QUESTION to the data instead of the data to the
 * model. "How many of these 3,412 incidents are on the A10" costs one small
 * aggregate rather than 400k tokens of incidents.
 *
 * Port of the agent toolkit's `analyseData`, minus session state: inputs are
 * `dataset_ids` rather than per-kind entry ids, and results are returned rather
 * than attached to an entry.
 */

import * as turf from "@turf/turf";
import * as h3 from "h3-js";
import type { AnalyseDataParams } from "../../schemas/datasets/analyseDataSchema";
import {
  type Dataset,
  explainMissingDataset,
  getDataset,
} from "../../services/datasets/dataset-store";
import { logger } from "../../utils/logger";
import { processSandboxExecutor, runSandboxedFn, validateAnalysisResult } from "../shared/sandbox";
import type { ToolResponse } from "../shared/tool-entry";

/**
 * The injected parameter names, in the order the sandbox receives them.
 *
 * `turf` and `h3` are listed because the body needs them in scope, but their
 * values are supplied INSIDE the worker — function namespaces cannot cross a
 * structured-clone boundary. The imports above exist so this module still
 * declares its real dependencies (and so a future main-thread executor could be
 * handed them directly).
 */
const SANDBOX_PARAMS = ["datasets", "features", "byDataset", "turf", "h3"] as const;

const error = (message: string): ToolResponse => ({
  content: [{ type: "text", text: JSON.stringify({ error: message }) }],
  isError: true,
});

/** Pulls the feature array out of whichever envelope a dataset holds. */
function featuresOf(data: unknown): unknown[] {
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.features)) return obj.features;
  if (Array.isArray(obj.incidents)) return obj.incidents;
  if (obj.type === "Feature") return [obj];
  // BYOD stores `{ geojson, layers, … }`.
  const geojson = obj.geojson as { features?: unknown[] } | undefined;
  if (geojson && Array.isArray(geojson.features)) return geojson.features;
  return [];
}

export async function analyseDataHandler(params: AnalyseDataParams): Promise<ToolResponse> {
  const { dataset_ids, code, description } = params;
  const outputFormat = params.outputFormat ?? "json";

  logger.info({ dataset_ids, outputFormat }, "Analyse data");

  // Resolve every dataset up front so a bad id fails before any code runs.
  const resolved: Dataset[] = [];
  const missing: string[] = [];
  for (const id of dataset_ids) {
    const dataset = getDataset(id);
    if (dataset) resolved.push(dataset);
    else missing.push(id);
  }

  if (missing.length) {
    // One explanation per missing id, each naming its originating call where the
    // provenance index still remembers it.
    return error(missing.map(explainMissingDataset).join(" "));
  }

  const datasets: Record<string, unknown> = {};
  const byDataset: Record<string, unknown[]> = {};
  const features: unknown[] = [];
  for (const dataset of resolved) {
    datasets[dataset.id] = dataset.data;
    const own = featuresOf(dataset.data);
    byDataset[dataset.id] = own;
    features.push(...own);
  }

  const started = Date.now();
  const sandboxResult = await runSandboxedFn(
    code,
    SANDBOX_PARAMS,
    // turf / h3 slots are filled inside the worker; see SANDBOX_PARAMS.
    [datasets, features, byDataset, turf, h3],
    "Analysis",
    processSandboxExecutor
  );
  const elapsedMs = Date.now() - started;

  if ("error" in sandboxResult) {
    logger.warn({ dataset_ids, elapsedMs, error: sandboxResult.error }, "Analysis failed");
    return error(sandboxResult.error);
  }

  const validated = validateAnalysisResult(sandboxResult.value, outputFormat);
  if ("error" in validated) return error(validated.error);

  logger.info({ dataset_ids, elapsedMs, featureCount: features.length }, "Analysis complete");

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            analysis: validated.value,
            outputFormat,
            ...(description && { description }),
            // What the analysis actually ran over, so a surprising number can be
            // traced to the input rather than assumed to be a code bug.
            analysed: {
              datasets: resolved.map((d) => ({
                dataset_id: d.id,
                producedBy: d.provenance.tool,
                features: byDataset[d.id].length,
              })),
              totalFeatures: features.length,
            },
            elapsedMs,
          },
          null,
          2
        ),
      },
    ],
  };
}
