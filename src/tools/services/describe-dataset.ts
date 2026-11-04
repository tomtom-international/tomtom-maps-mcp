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
 * `tomtom-describe-dataset` — what is IN a held dataset, without shipping it.
 *
 * A model cannot write a correct filter for `tomtom-analyse-datasets` or
 * `tomtom-derive-datasets` over data whose shape it has never seen, so this
 * describes the ACTUAL data: real property paths, real presence counts, and the
 * real value vocabulary of low-cardinality fields.
 */

import type { DescribeDatasetParams } from "../../schemas/datasets/datasetSchema";
import { requireDataset } from "../../services/datasets/dataset-store";
import { DEFAULT_SUMMARY_SAMPLE, summarize } from "../../services/datasets/summarize";
import { logger } from "../../utils/logger";
import { buildErrorResponse } from "../shared/response-trimmer";
import type { ToolResponse } from "../shared/tool-entry";

export async function describeDatasetHandler(params: DescribeDatasetParams): Promise<ToolResponse> {
  const { dataset_id, sample = DEFAULT_SUMMARY_SAMPLE } = params;
  logger.info({ dataset_id }, "Describe dataset");

  try {
    const dataset = requireDataset(dataset_id);
    // The stored summary is computed at write time with the default sample size.
    // Re-summarise only when the caller asked for a different one, so the common
    // path costs nothing.
    const summary =
      sample === DEFAULT_SUMMARY_SAMPLE ? dataset.summary : summarize(dataset, sample);
    const { tool, description, derivedFrom } = dataset.provenance;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            dataset_id: dataset.id,
            producedBy: tool,
            ...(description && { description }),
            ...(derivedFrom && { derivedFrom }),
            ageSeconds: Math.round((Date.now() - dataset.createdAt) / 1000),
            ...summary,
          }),
        },
      ],
    };
  } catch (error) {
    return buildErrorResponse(error, "Describe dataset");
  }
}
