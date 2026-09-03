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
 * The data-tool pipeline, extracted from 15 hand-written handler factories that
 * all performed the same five steps:
 *
 *   1. strip the transport-level params (`show_ui`)
 *   2. call the service
 *   3. project the result to what the model sees
 *   4. store the FULL result and return the projection plus its `dataset_id`
 *
 * …plus an identical `catch` block. Each tool now supplies only its `execute`
 * and its `project`, matching how the agent toolkit's tool modules own an
 * `execute` and let the framework wrap it.
 */

import { handleApiError } from "../../utils/apiErrorHandler";
import { logger } from "../../utils/logger";
import { buildCompressedResponse } from "./response-trimmer";
import type { ToolDataKind, ToolResponse } from "./tool-entry";

/** Transport-level params every data tool accepts, stripped before `execute`. */
export interface DataToolTransportParams {
  show_ui?: boolean;
}

export interface DataToolConfig<Params extends DataToolTransportParams, Result> {
  /**
   * Human-readable action, used as the log message and the `handleApiError`
   * prefix — e.g. `"Geocoding"`, `"Route calculation"`. Keeps error strings
   * identical to the hand-written handlers they replace.
   */
  verb: string;

  /**
   * The MCP tool name, recorded as the dataset's provenance so a consumer of a
   * `dataset_id` can tell what produced it — and so a future phase can rebuild an
   * expired dataset by replaying the call.
   */
  name: string;

  /** What this tool produces; drives the dataset summary. */
  kind?: ToolDataKind;

  /**
   * The work itself: validated params in (transport params already stripped),
   * raw untrimmed API response out. Throwing is the way to report failure — the
   * wrapper owns the `handleApiError` + `isError` shaping.
   */
  execute: (params: Omit<Params, keyof DataToolTransportParams>) => Promise<Result>;

  /**
   * Projects the raw result to the agent-facing value. The RAW result is always
   * what gets cached for the app, so a projection may drop as much as it likes
   * without costing the UI anything.
   *
   * Receives the params too, for projections that are parameterised (traffic
   * caps its incident list at `maxResults`).
   */
  project: (result: Result, params: Omit<Params, keyof DataToolTransportParams>) => unknown;

  /**
   * Optional pre-flight check. Return a message to reject the call before any
   * API request is made; return `undefined` to proceed. Used by
   * `tomtom-reachable-range`, which requires at least one budget parameter.
   */
  validate?: (params: Omit<Params, keyof DataToolTransportParams>) => string | undefined;

  /**
   * Pretty-print the agent-facing JSON (default `true`). `false` emits compact
   * JSON, roughly halving whitespace overhead — used for high-cardinality
   * responses like traffic.
   */
  pretty?: boolean;

  /**
   * Extra structured fields for the success log line, derived from the result.
   * Replaces the ad-hoc `logger.info({ count }, "…")` calls in the old handlers.
   */
  logResult?: (result: Result) => Record<string, unknown>;
}

/**
 * Builds the MCP handler for a data tool from its `execute` + `project`.
 *
 * @returns a handler suitable for a {@link ToolEntry}'s `handler` field.
 */
export function defineDataTool<Params extends DataToolTransportParams, Result>(
  config: DataToolConfig<Params, Result>
): (params: Params) => Promise<ToolResponse> {
  const { verb, name, kind, execute, project, validate, pretty = true, logResult } = config;

  return async (params: Params): Promise<ToolResponse> => {
    const { show_ui = true, ...rest } = params;
    const toolParams = rest as Omit<Params, keyof DataToolTransportParams>;

    const rejection = validate?.(toolParams);
    if (rejection) {
      return { content: [{ type: "text", text: rejection }], isError: true };
    }

    logger.info({ verb }, verb);
    try {
      const result = await execute(toolParams);
      logger.info({ verb, ...logResult?.(result) }, `${verb} succeeded`);

      return await buildCompressedResponse(project(result, toolParams), result, show_ui, pretty, {
        kind,
        provenance: { tool: name, params: toolParams },
      });
    } catch (error: unknown) {
      const formattedError = handleApiError(error, verb);
      logger.error({ verb, error: formattedError.message }, `${verb} failed`);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: formattedError.message }) }],
        isError: true,
      };
    }
  };
}
