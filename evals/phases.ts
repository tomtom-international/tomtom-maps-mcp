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
 * The phase series under measurement.
 *
 * The consolidation landed as one commit, which makes "did it work" an
 * unanswerable question: the tool collapse, server-side code execution and
 * server-held datasets all arrived together, so any number moved by all three at
 * once. These four checkouts take them apart, each adding exactly one thing to
 * the one before it:
 *
 *   phase 0 → phase 1   fewer, wider tools               (no new capability)
 *   phase 1 → phase 2   code execution over one result   (no state)
 *   phase 2 → phase 3   datasets: handles, and code across them
 *
 * Every phase is scored by the SAME corpus, judge and model, run from THIS tree
 * and pointed at each checkout in turn (`EVAL_SERVER_ROOT`). Nothing about the
 * measurement changes between phases — only which server answers.
 */

export interface Phase {
  /** Artefact label: `report.<id>.json`, `runs.<id>.jsonl`. */
  id: string;
  /** Ordinal, for "compared with the phase before it". */
  ordinal: number;
  /** Short name for reports. */
  title: string;
  /** Checkout, relative to the repo root. */
  root: string;
  /** Tool vocabulary — drives how scenario expectations are scored. */
  surface: "legacy" | "consolidated";
  /** What this phase adds to the one before it. */
  adds: string;
  /** One-paragraph statement of what it is for. */
  intent: string;
}

export const PHASES: readonly Phase[] = [
  {
    id: "phase0",
    ordinal: 0,
    title: "Before the consolidation",
    root: "../tomtom-mcp-baseline",
    surface: "legacy",
    adds: "—",
    intent:
      "The surface as it shipped: 15 model-visible tools, one per API endpoint. Every response " +
      "is trimmed to fit the conversation and the trimming is lossy, so a question about a field " +
      "that was dropped, or a total over a list that was capped, has no path to an answer.",
  },
  {
    id: "phase1",
    ordinal: 1,
    title: "Consolidated tools",
    root: "../tomtom-mcp-phase1",
    surface: "consolidated",
    adds: "Fewer, wider tools — no new capability",
    intent:
      "The tool collapse on its own: 15 tools become 9, with resolvers that take a place NAME " +
      "where the old surface took coordinates. This is a HOP-COUNT change, not a capability " +
      "change — nothing is answerable here that was not answerable before. Measuring it alone is " +
      "what separates 'the agent picks the right tool' from 'the agent can compute the answer'.",
  },
  {
    id: "phase2",
    ordinal: 2,
    title: "Code execution, no state",
    root: "../tomtom-mcp-phase2",
    surface: "consolidated",
    adds: "`analyse` — code over this call's own result",
    intent:
      "Every data tool gains an optional `analyse`: JavaScript run on the server over the FULL " +
      "untrimmed result of that same call, returning only what the code returns. The tool LIST is " +
      "identical to phase 1, so any movement is attributable to code execution rather than to a " +
      "new routing target. Nothing is held between calls, so the code sees one result at a time.",
  },
  {
    id: "phase3",
    ordinal: 3,
    title: "Server-held datasets",
    root: "../tomtom-mcp-phase3",
    surface: "consolidated",
    adds: "`dataset_id` handles + `describe-dataset` / `analyse-data`",
    intent:
      "Results become addressable. Every tool returns a `dataset_id`; `tomtom-describe-dataset` " +
      "reports what is in one and `tomtom-analyse-data` runs code across SEVERAL. This is what " +
      "phase 2 cannot express: relating one tool's result to another's, and refining an analysis " +
      "without paying for the data twice.",
  },
];

export const phaseById = (id: string): Phase | undefined => PHASES.find((p) => p.id === id);
