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
 * `analyse` — the field that turns a data tool into a question you can ask of it.
 *
 * Every data tool already computes far more than it returns; the response is a
 * trimmed, capped projection of it. `analyse` runs JavaScript over the FULL result
 * on the server and returns only what that code produces, so the answer is
 * computed from all of the data while none of it crosses the conversation.
 *
 * Deliberately one field on every tool rather than a separate analysis tool:
 * there is nothing held between calls to point an analysis tool AT. The code
 * sees this call's result and nothing else.
 */

import { z } from "zod";
import { analyseDescriptionFor } from "./response-shapes";

/**
 * Builds the `analyse` field for one tool.
 *
 * Per-tool rather than shared, because the useful half of this description is the
 * shape of THAT tool's result — and without it the model is writing a filter
 * against a response it has never seen. See `response-shapes.ts`.
 */
export const analyseSchemaFor = (toolName: string) =>
  z
    .string()
    .optional()
    .describe(
      "JavaScript to run over the FULL result of THIS call, on the server. Returns only what your " +
        "code returns — the untrimmed data never enters the conversation. " +
        "Use it whenever the answer needs more of the data than a response can show: counts and " +
        "totals over the whole result set, groupings and breakdowns, top-N rankings, filtering on " +
        "a field the trimmed response omits, or spatial work (distances, containment, corridors). " +
        "Prefer it over reasoning from a truncated list — a total computed from a capped list is " +
        "simply wrong. " +
        `${analyseDescriptionFor(toolName)} ` +
        "It runs against one call's result: to relate two tools' results, ask each its own question."
    );
