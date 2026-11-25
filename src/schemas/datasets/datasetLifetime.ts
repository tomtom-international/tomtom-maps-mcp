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
 * How long the server holds a dataset, which the dataset tools' descriptions state.
 */

import { appConfig } from "../../appConfig";

/** How long a dataset lives after it was last read; see `datasetTtlSeconds` in `appConfig.ts`. */
export const DATASET_TTL_SECONDS = appConfig.datasetTtlSeconds;

/** How long datasets live, in words, for tool descriptions and error messages. */
export const datasetLifetimePhrase = (): string => {
  const minutes = DATASET_TTL_SECONDS / 60;
  if (Number.isInteger(minutes)) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `${DATASET_TTL_SECONDS} seconds`;
};
