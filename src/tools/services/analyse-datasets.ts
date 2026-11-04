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
 * `tomtom-analyse-datasets` — code execution over server-held datasets.
 *
 * A trimmed response answers only what survived the trimming; this sends the
 * QUESTION to the data instead. "How many of these 3,412 incidents are on the A10"
 * costs one small aggregate rather than 400k tokens of incidents.
 *
 * Its result is returned, not kept: a result worth keeping is `tomtom-derive-datasets`'s.
 */

import type { AnalyseDatasetsParams } from "../../schemas/datasets/analyseDatasetsSchema";
import { IncorrectError } from "../../types/types";
import { logger } from "../../utils/logger";
import { runDatasetCode, suspicionsIn, suspiciousResultError } from "../shared/dataset-code";
import { buildErrorResponse, errorResult } from "../shared/response-trimmer";
import { validateAnalysisResult } from "../shared/sandbox/sandbox-code";
import type { ToolResponse } from "../shared/tool-entry";

export async function analyseDatasetsHandler(params: AnalyseDatasetsParams): Promise<ToolResponse> {
  const { dataset_ids, code, description } = params;
  const outputFormat = params.outputFormat ?? "json";

  logger.info({ dataset_ids, outputFormat }, "Analyse datasets");

  try {
    const run = await runDatasetCode(dataset_ids, code, "Analysis");
    if ("error" in run) {
      logger.warn({ dataset_ids, error: run.error }, "Analysis failed");
      return errorResult(new IncorrectError(run.error));
    }

    const validated = validateAnalysisResult(run.value, outputFormat);
    if ("error" in validated) return errorResult(new IncorrectError(validated.error));

    const suspicions = run.features.length ? suspicionsIn(validated.value) : [];
    if (suspicions.length) {
      logger.info({ dataset_ids, suspicions }, "Analysis result looks wrong");
      return suspiciousResultError(suspicions, { analysis: validated.value });
    }

    logger.info(
      { dataset_ids, elapsedMs: run.elapsedMs, featureCount: run.features.length },
      "Analysis complete"
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            analysis: validated.value,
            outputFormat,
            ...(description && { description }),
            // What the analysis actually ran over, so a surprising number can be
            // traced to the input rather than assumed to be a code bug.
            analysed: run.read,
            elapsedMs: run.elapsedMs,
          }),
        },
      ],
    };
  } catch (error) {
    return buildErrorResponse(error, "Analyse datasets");
  }
}
