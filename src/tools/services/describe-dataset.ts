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
 * The stateless counterpart to the agent toolkit's `recallState`, and the reason
 * phase 2's code execution can work: a model cannot write a correct filter over
 * data it has never seen the shape of. Rather than describing kinds statically
 * (the toolkit's approach, since its shapes are fixed), this describes the ACTUAL
 * data — real property paths, real presence counts, and the real value vocabulary
 * for low-cardinality fields.
 */

import type { DescribeDatasetParams } from "../../schemas/datasets/datasetSchema";
import { explainMissingDataset, getDataset } from "../../services/datasets/dataset-store";
import { summarize } from "../../services/datasets/summarize";
import { logger } from "../../utils/logger";
import type { ToolResponse } from "../shared/tool-entry";

const DEFAULT_SAMPLE = 2;

export async function describeDatasetHandler(params: DescribeDatasetParams): Promise<ToolResponse> {
  const { dataset_id, sample = DEFAULT_SAMPLE } = params;
  logger.info({ dataset_id }, "Describe dataset");

  const dataset = getDataset(dataset_id);
  if (!dataset) {
    // Names the originating call when the provenance index still remembers it,
    // so the model can re-issue exactly that rather than guess. Still says
    // nothing about another caller's dataset — both lookups are owner-scoped.
    return {
      content: [
        { type: "text", text: JSON.stringify({ error: explainMissingDataset(dataset_id) }) },
      ],
      isError: true,
    };
  }

  // The stored summary is computed at write time with the default sample size.
  // Re-summarise only when the caller asked for a different one, so the common
  // path costs nothing.
  const summary =
    sample === DEFAULT_SAMPLE ? dataset.summary : summarize(dataset.data, dataset.kind, sample);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            dataset_id: dataset.id,
            producedBy: dataset.provenance.tool,
            ageSeconds: Math.round((Date.now() - dataset.createdAt) / 1000),
            ...summary,
          },
          null,
          2
        ),
      },
    ],
  };
}
