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
 * App-internal tool executors. These are registered with `visibility: "app"`, so
 * the MCP app can call them and the model never sees them.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callerForLog } from "../clientSession";
import {
  APP_DATA_FETCH_REASONS,
  APP_DATA_SOURCES,
  APP_FAILURE_STAGES,
  APP_STATUSES,
} from "../constants";
import { getEffectiveApiKey, serverUserAgentName } from "../services/api-key";
import { IncorrectError } from "../types/types";
import { logger } from "../utils/logger";
import { buildUserAgent, deriveMcpAppUserAgentName } from "../utils/userAgent";
import { APP_DATA, type AppData } from "./shared/app-data";
import { buildErrorResponse } from "./shared/response-trimmer";
import type { ToolCall, ToolCallExtra, ToolResponse } from "./shared/tool-entry";

export const getApiKeySchema = {};
export const getAppConfigSchema = {};

export const getAppDataSchema = {
  tool: z
    .string()
    .max(64)
    .describe("The tool whose result the app draws, from the result's _meta.tool"),
  arguments: z.record(z.string(), z.unknown()).describe("That tool call's arguments"),
  reason: z
    .enum(APP_DATA_FETCH_REASONS)
    .describe("Why the app fetches: the result had no inline app data, or it failed to decode"),
};

export const reportAppStatusSchema = {
  tool: z.string().max(64).optional().describe("The tool whose result the app draws"),
  status: z.enum(APP_STATUSES),
  source: z.enum(APP_DATA_SOURCES).optional().describe("Where the drawn data came from"),
  stage: z.enum(APP_FAILURE_STAGES).optional().describe("Where a failure happened"),
  error: z.string().max(300).optional(),
  duration_ms: z.number().nonnegative().optional(),
};

/** Runs a tool for its result, app data included (CONTEXT.md, App data). */
export type ToolRun = (args: unknown, extra: ToolCallExtra) => Promise<ToolResponse>;

/** The tools each server runs again for their app data: only those registered with `refetch`. */
const appDataRuns = new WeakMap<McpServer, Map<string, ToolRun>>();

export function addAppDataRun(server: McpServer, name: string, run: ToolRun): void {
  const runs = appDataRuns.get(server) ?? new Map<string, ToolRun>();
  appDataRuns.set(server, runs);
  runs.set(name, run);
}

/**
 * The full app data of tool `name` called with `args`, for an app that didn't
 * get it inline. Any replica can answer, since the tool runs again.
 * Undefined when the tool failed.
 *
 * @throws {IncorrectError} For a tool not registered with `refetch`, or arguments the tool rejects.
 */
export async function appDataOf(
  server: McpServer,
  name: string,
  args: unknown,
  extra: ToolCallExtra
): Promise<{ appData?: AppData; result: ToolResponse }> {
  const run = appDataRuns.get(server)?.get(name);
  if (!run) {
    throw new IncorrectError(
      "The tool doesn't run again for its app data: only tomtom-data-viz does.",
      { tool: name }
    );
  }
  const result = await run(args, extra);
  return { appData: result[APP_DATA], result };
}

type GetAppDataParams = z.infer<z.ZodObject<typeof getAppDataSchema>>;
type ReportAppStatusParams = z.infer<z.ZodObject<typeof reportAppStatusSchema>>;

export async function getApiKeyHandler(): Promise<ToolResponse> {
  const apiKey = getEffectiveApiKey();

  if (!apiKey) {
    return { content: [{ type: "text", text: "API key not available" }], isError: true };
  }

  return { content: [{ type: "text", text: apiKey }], isError: false };
}

export async function getAppConfigHandler(): Promise<ToolResponse> {
  // MCP App traffic mirrors the server identity with the layer token
  // swapped (SDK -> APP), keeping every deployment dimension. Read the
  // live binding inside the handler: setHttpMode() may run after module load.
  const mcpAppUserAgentName = deriveMcpAppUserAgentName(serverUserAgentName);
  const userAgent = buildUserAgent(mcpAppUserAgentName);

  return {
    content: [{ type: "text", text: JSON.stringify({ userAgent }) }],
    isError: false,
  };
}

/**
 * The data-viz app's data when it is missing from the result: runs tomtom-data-viz
 * again, so any replica answers. TomTom tools never run again (CONTEXT.md, App data).
 */
export async function getAppDataHandler(
  params: GetAppDataParams,
  { server, extra }: ToolCall
): Promise<ToolResponse> {
  const started = performance.now();
  const caller = { tool: params.tool, reason: params.reason, ...callerForLog(server, extra) };
  let fetched: Awaited<ReturnType<typeof appDataOf>>;
  try {
    fetched = await appDataOf(server, params.tool, params.arguments, extra);
  } catch (error) {
    logger.warn(
      { ...caller, error: error instanceof Error ? error.message : String(error) },
      "App data fetch failed"
    );
    return buildErrorResponse(error, "tomtom-get-app-data");
  }
  const { appData, result } = fetched;
  const fields = {
    ...caller,
    ...appData?.report,
    duration_ms: Math.round(performance.now() - started),
  };
  if (!appData) {
    logger.warn(fields, "App data fetch failed");
    return result.isError ? result : unavailable();
  }
  // Data that fit inline reached the app, which still had to fetch it.
  if (appData.report.delivery === "inline") {
    logger.warn(
      fields,
      params.reason === "decode_failed"
        ? "App data fetched: app failed to decode it"
        : "App data fetched: host dropped it"
    );
  } else logger.info(fields, "App data fetched");
  return { content: [{ type: "text", text: JSON.stringify(appData.data) }] };
}

/** Logs whether an app drew, so a map that fails is never silent. */
export async function reportAppStatusHandler(
  params: ReportAppStatusParams,
  { server, extra }: ToolCall
): Promise<ToolResponse> {
  const fields = {
    ...params,
    ...(params.error && { error: withoutApiKey(params.error) }),
    ...callerForLog(server, extra),
  };
  if (params.status === "failed") logger.warn(fields, "App failed");
  else logger.info(fields, "App drawn");
  return { content: [{ type: "text", text: "ok" }] };
}

/**
 * An app's error message without the API key. A failed request's message can
 * quote its URL, and the maps-sdk puts the key in style and sprite URLs as `key=`.
 */
function withoutApiKey(message: string): string {
  const apiKey = getEffectiveApiKey();
  const redacted = message.replace(/([?&]key=)[^&#\s"'<>)]+/gi, "$1REDACTED");
  return apiKey ? redacted.split(apiKey).join("REDACTED") : redacted;
}

function unavailable(): ToolResponse {
  return { content: [{ type: "text", text: "App data unavailable" }], isError: true };
}
