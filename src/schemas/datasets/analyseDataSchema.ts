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

/**
 * The `code` field's description. This is the highest-leverage prose in the tool:
 * almost every failure mode is a model writing plausible-but-wrong sandbox code,
 * and the fixes are cheaper stated up front than discovered through error hints.
 *
 * Adapted from the agent toolkit's `buildSandboxCodePrompt` +
 * `buildAnalyseReturnPrompt`, narrowed to this tool's injected names.
 */
const CODE_DOC = [
  "Async JavaScript FUNCTION BODY that aggregates the datasets and returns a result.",
  "Not a function expression — do not wrap it in `(args) => {...}`; just write statements ending in `return ...;`.",
  "",
  "IN SCOPE (injected as parameters — use directly, never redeclare or import):",
  "• `datasets` — object keyed by dataset_id. `datasets['ds_x']` is that tool's FULL untrimmed response.",
  "• `features` — every feature from every requested dataset, already flattened into one array. Use this for the common case.",
  "• `byDataset` — object keyed by dataset_id giving each dataset's own feature array, for per-dataset comparisons.",
  "• `turf` — @turf/turf v7 (geometry). Verify names at https://turfjs.org/docs/.",
  "• `h3` — h3-js (hex grid math).",
  "",
  "NOT AVAILABLE: network, filesystem, `require`/`import`, other tools. The sandbox sees only the",
  "datasets you list in `dataset_ids`. To bring in more data, call the search/routing tool first and",
  "pass its dataset_id here.",
  "",
  "TURF INPUTS: pass a Feature or FeatureCollection, never a bare Array and never raw coordinates.",
  "Wrap a list with `turf.featureCollection(features)`. Datasets mix Point / LineString / Polygon —",
  "guard with `f.geometry.type === 'Point'` before point-only ops, or use `turf.booleanIntersects`",
  "which accepts any geometry.",
  "",
  "PERFORMANCE: for large nearest/within queries, pre-bucket with `h3.latLngToCell(lat, lng, res)` +",
  "`h3.gridDisk(cell, k)` and compare only same-cell or neighbour-cell pairs — O(N·M) becomes ~O(N+M).",
  "There is a 10 second execution limit.",
  "",
  "RETURN VALUE must be pure JSON — plain objects, arrays, strings, numbers, booleans, null.",
  "No functions, classes, Maps, Sets or circular references. Keep it SMALL: the point of this tool is",
  "that the aggregate comes back, not the data. Returning every feature defeats it.",
  "• `json` (default) — a compact object: counts, groupings, totals, top-N lists, hex bins.",
  "• `chart` — a Chart.js config:",
  '  `{ type: "bar"|"line"|"pie"|"doughnut"|"radar"|"polarArea"|"scatter"|"bubble", data: { labels, datasets }, options? }`.',
  "",
  "Call tomtom-describe-dataset first if you are unsure which property paths exist — it reports the",
  "real paths, their types, and the value vocabulary of low-cardinality fields.",
].join("\n");

export const tomtomAnalyseDataSchema = {
  dataset_ids: z
    .array(z.string())
    .min(1)
    .describe(
      "The dataset_ids to analyse, from earlier tool responses' `_meta.dataset_id`. " +
        "List every dataset the code needs — the sandbox can see nothing else."
    ),
  code: z.string().describe(CODE_DOC),
  outputFormat: z
    .enum(["json", "chart"])
    .optional()
    .describe(
      'Shape of the returned value (default "json"). Use "chart" when the user asked for a chart, ' +
        "graph, plot or histogram — the code must then return a Chart.js configuration."
    ),
  description: z
    .string()
    .optional()
    .describe("Short description of what the analysis computes, echoed back in the result."),
};

export type AnalyseDataParams = z.input<z.ZodObject<typeof tomtomAnalyseDataSchema>>;
