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
 * `tomtom-derive-datasets` — code over held datasets that returns a NEW one.
 *
 * Where `tomtom-analyse-datasets` answers, this keeps: a filter, a join, a buffer,
 * a stretch of a route, a table of rows. The result is stored like any tool's, so
 * its `dataset_id` feeds every input that takes one, this tool included, and the
 * response carries the summary `tomtom-describe-dataset` would give, since a
 * derived dataset's shape is whatever its code built. Its one output kind is any
 * GeoJSON.
 */

import type { DeriveDatasetsParams } from "../../schemas/datasets/deriveDatasetsSchema";
import { datasetReference, storeDataset } from "../../services/datasets/dataset-store";
import { derivedFeatureCollection } from "../../services/datasets/geojson";
import { IncorrectError } from "../../types/types";
import { logger } from "../../utils/logger";
import { runDatasetCode, suspicionsIn, suspiciousResultError } from "../shared/dataset-code";
import { buildErrorResponse, errorResult } from "../shared/response-trimmer";
import type { ToolResponse } from "../shared/tool-entry";

const TOOL = "tomtom-derive-datasets";

export async function deriveDatasetsHandler(params: DeriveDatasetsParams): Promise<ToolResponse> {
  const { dataset_ids, code, description } = params;
  logger.info({ dataset_ids }, "Derive datasets");

  try {
    const run = await runDatasetCode(dataset_ids, code, "Derivation");
    if ("error" in run) {
      logger.warn({ dataset_ids, error: run.error }, "Derivation failed");
      return errorResult(new IncorrectError(run.error));
    }

    const derived = derivedFeatureCollection(run.value);
    const properties = derived.features.map((feature) => feature.properties);
    const suspicions = run.features.length ? suspicionsIn(properties) : [];
    if (suspicions.length) {
      logger.info({ dataset_ids, suspicions }, "Derived dataset looks wrong");
      return suspiciousResultError(suspicions, {
        features: derived.features.length,
        sample: properties.slice(0, 3),
      });
    }

    const dataset = storeDataset(derived, {
      tool: TOOL,
      params: { dataset_ids, description, code },
      derivedFrom: [...dataset_ids],
      description,
    });
    logger.info(
      {
        dataset_ids,
        dataset_id: dataset.id,
        count: dataset.summary.count,
        elapsedMs: run.elapsedMs,
      },
      "Derived dataset"
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ...datasetReference(dataset),
            description,
            derivedFrom: dataset.provenance.derivedFrom,
            ...dataset.summary,
            elapsedMs: run.elapsedMs,
          }),
        },
      ],
    };
  } catch (error) {
    return buildErrorResponse(error, "Derive datasets");
  }
}
