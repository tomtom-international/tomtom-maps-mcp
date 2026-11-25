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
import { datasetIdsSchema } from "./datasetSchema";

/**
 * The `code` field's description. The scope, helpers and dataset shapes are
 * tomtom-analyse-datasets' and are named rather than repeated: both ship on every
 * `tools/list`, and repeating them would cost every turn 2.5 KB.
 */
const CODE_DOC = [
  "Async JavaScript FUNCTION BODY that builds a NEW dataset from the datasets and returns it.",
  "It runs exactly like tomtom-analyse-datasets' `code`: the same `datasets`, `features`,",
  "`byDataset`, `turf`, `h3` and `place` / `route` / `incident` helpers in scope, the same limits,",
  "and the DATASET SHAPES listed there.",
  "",
  "RETURN VALUE is the new dataset, as GeoJSON: a FeatureCollection, an array of Features, one",
  "Feature, or a bare geometry. Any geometry type, mixed in one dataset if you like; a feature with",
  "`geometry: null` is a row with no place (one per road, with its counts). A GeometryCollection",
  "becomes one feature per geometry. An empty result is refused, and so is one over 8 MB",
  "(`turf.simplify` a long line).",
  "• KEEP the source features' properties when you filter or annotate one:",
  "  `{ ...f, properties: { ...f.properties, distanceMeters } }`, so the helpers still read it.",
  "• Put what a later step needs in properties: a computed distance, a count, the id of the feature",
  "  it was matched with.",
  "• Order features as later steps will use them: tools that take one point or one line read the",
  "  FIRST feature.",
].join("\n");

export const tomtomDeriveDatasetsSchema = {
  dataset_ids: datasetIdsSchema,
  code: z.string().describe(CODE_DOC),
  description: z
    .string()
    .describe(
      'What the new dataset holds, in a few words: "fast chargers within 100 m of a closure". ' +
        "Kept with the dataset, so a later step can tell what each one is."
    ),
};

export type DeriveDatasetsParams = z.input<z.ZodObject<typeof tomtomDeriveDatasetsSchema>>;
