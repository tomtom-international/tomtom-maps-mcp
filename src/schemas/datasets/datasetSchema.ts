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
 */

import { z } from "zod";
import { datasetLifetimePhrase } from "../../services/datasets/dataset-store";

export const tomtomDescribeDatasetSchema = {
  dataset_id: z
    .string()
    .describe(
      "The dataset_id from a previous tool response's `_meta.dataset_id`. " +
        `Datasets belong to the caller and expire after ${datasetLifetimePhrase()}.`
    ),
  sample: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .describe(
      "How many whole, untrimmed features to include (default 2, max 10). " +
        "Raise it when you need to see the exact shape of a field the summary only " +
        "describes — but the summary itself is what to reason about, not the sample."
    ),
};

export type DescribeDatasetParams = z.input<z.ZodObject<typeof tomtomDescribeDatasetSchema>>;
