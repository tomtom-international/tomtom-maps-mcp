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
 * Runs a tool's `analyse` code over that tool's own fresh result.
 *
 * The stateless half of the agent toolkit's `analyseData`: the same sandbox and
 * the same injected globals, but the data comes from the call in progress rather
 * than from a stored entry. Nothing is held between calls, so there is no handle
 * to pass, nothing to expire, and no id for the model to keep track of.
 *
 * The cost of that is real and worth naming: the code sees ONE tool's result. A
 * question spanning two tools ("which of these chargers is inside that isochrone")
 * cannot be expressed here — that needs handles, which is the next phase.
 */

import * as turf from "@turf/turf";
import * as h3 from "h3-js";
import { logger } from "../../utils/logger";
import { processSandboxExecutor, runSandboxedFn, validateAnalysisResult } from "./sandbox";
import type { ToolResponse } from "./tool-entry";

/**
 * Injected parameter names, in the order the sandbox receives them.
 *
 * `turf` and `h3` are listed so the body has them in scope, but their values are
 * supplied INSIDE the worker — function namespaces cannot cross a
 * structured-clone boundary. The imports above keep this module's real
 * dependencies declared.
 */
const SANDBOX_PARAMS = ["features", "data", "turf", "h3"] as const;

/** Pulls the feature array out of whichever envelope a tool result uses. */
export function featuresOf(data: unknown): unknown[] {
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.features)) return obj.features;
  if (Array.isArray(obj.incidents)) return obj.incidents;
  if (obj.type === "Feature") return [obj];
  return [];
}

/**
 * Executes `code` over `data` and shapes the tool response.
 *
 * Returns the computed value INSTEAD of the tool's normal projection — a query
 * is a different question, not an addition to the usual answer, and returning
 * both would put back exactly the payload the query exists to avoid.
 *
 * @param code   the model-supplied function body
 * @param data   the tool's full, untrimmed result
 * @param verb   human-readable action, used in error strings and logs
 */
export async function runToolQuery(
  code: string,
  data: unknown,
  verb: string
): Promise<ToolResponse> {
  const features = featuresOf(data);
  const started = Date.now();

  const result = await runSandboxedFn(
    code,
    SANDBOX_PARAMS,
    // turf / h3 slots are filled inside the worker; see SANDBOX_PARAMS.
    [features, data, turf, h3],
    verb,
    processSandboxExecutor
  );
  const elapsedMs = Date.now() - started;

  if ("error" in result) {
    logger.warn({ verb, elapsedMs, error: result.error }, "Analysis failed");
    return {
      content: [{ type: "text", text: JSON.stringify({ error: result.error }) }],
      isError: true,
    };
  }

  const validated = validateAnalysisResult(result.value, "json");
  if ("error" in validated) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: validated.error }) }],
      isError: true,
    };
  }

  logger.info({ verb, elapsedMs, featureCount: features.length }, "Analysis complete");

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            analysis: validated.value,
            // What the code actually ran over, so a surprising number can be
            // traced to the input rather than assumed to be a bug in the code.
            queriedOver: { tool: verb, features: features.length },
            elapsedMs,
          },
          null,
          2
        ),
      },
    ],
  };
}
