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

import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WithoutApps } from "../clientApps";
import { callerForLog } from "../clientSession";
import {
  APP_DATA_FETCH_REASONS,
  APP_DATA_SOURCES,
  APP_FAILURE_STAGES,
  APP_STATUSES,
} from "../constants";
import { buildErrorResponse } from "../handlers/shared/responseTrimmer";
import { getEffectiveApiKey, serverUserAgentName } from "../services/base/tomtomClient.js";
import { logger } from "../utils/logger.js";
import { buildUserAgent, deriveMcpAppUserAgentName } from "../utils/userAgent.js";
import { appDataOf } from "./helpers/registerTomTomAppTool.js";

const getApiKeySchema = z.object({});
const getAppConfigSchema = z.object({});

const getAppDataSchema = z.object({
  tool: z
    .string()
    .max(64)
    .describe("The tool whose result the app draws, from the text's _meta.tool"),
  arguments: z.record(z.string(), z.unknown()).describe("That tool call's arguments"),
  reason: z
    .enum(APP_DATA_FETCH_REASONS)
    .describe("Why the app fetches: the result had no inline app data, or it failed to decode"),
});

const reportAppStatusSchema = z.object({
  tool: z.string().max(64).optional().describe("The tool whose result the app draws"),
  status: z.enum(APP_STATUSES),
  source: z.enum(APP_DATA_SOURCES).optional().describe("Where the drawn data came from"),
  stage: z.enum(APP_FAILURE_STAGES).optional().describe("Where a failure happened"),
  error: z.string().max(300).optional(),
  duration_ms: z.number().nonnegative().optional(),
});

/**
 * Creates and registers app-internal tools
 * These tools are only visible to apps, not to the LLM
 */
export function createAppTools(server: McpServer): WithoutApps {
  const apiKeyTool = registerAppTool(
    server,
    "tomtom-get-api-key",
    {
      title: "Get TomTom API Key",
      description: "Internal tool for apps to retrieve the TomTom API key",
      inputSchema: getApiKeySchema.shape,
      annotations: {
        title: "Get TomTom API Key",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["app"],
        },
      },
    },
    async () => {
      const apiKey = getEffectiveApiKey();

      if (!apiKey) {
        return {
          content: [{ type: "text" as const, text: "API key not available" }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text" as const, text: apiKey }],
        isError: false,
      };
    }
  );

  // Tool for apps to fetch client configuration (attribution user-agent etc.)
  // Kept separate from tomtom-get-api-key so the key tool's plain-text
  // contract stays untouched.
  const appConfigTool = registerAppTool(
    server,
    "tomtom-get-app-config",
    {
      title: "Get TomTom App Config",
      description:
        "Internal tool for apps to retrieve client configuration such as the attribution user-agent",
      inputSchema: getAppConfigSchema.shape,
      annotations: {
        title: "Get TomTom App Config",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["app"],
        },
      },
    },
    async () => {
      // MCP App traffic mirrors the server identity with the layer token
      // swapped (SDK -> APP), keeping every deployment dimension. Read the
      // live binding inside the handler: setHttpMode() may run after module load.
      const mcpAppUserAgentName = deriveMcpAppUserAgentName(serverUserAgentName);
      const userAgent = buildUserAgent(mcpAppUserAgentName);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ userAgent }),
          },
        ],
        isError: false,
      };
    }
  );

  // Tool for the data-viz app when its data didn't fit the result: runs tomtom-data-viz
  // again, so any replica answers. TomTom tools never run again (CONTEXT.md, App data).
  const appDataTool = registerAppTool(
    server,
    "tomtom-get-app-data",
    {
      title: "Get App Data",
      description:
        "Internal tool for the data-viz app to get data too large for the result, by running tomtom-data-viz again",
      inputSchema: getAppDataSchema.shape,
      annotations: {
        title: "Get App Data",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: {
        ui: {
          visibility: ["app"],
        },
      },
    },
    async (params: z.infer<typeof getAppDataSchema>, extra) => {
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
      return { content: [{ type: "text" as const, text: JSON.stringify(appData.data) }] };
    }
  );

  // Tool for apps to report whether they drew, so a map that fails is never silent.
  const appStatusTool = registerAppTool(
    server,
    "tomtom-report-app-status",
    {
      title: "Report App Status",
      description: "Internal tool for apps to report whether they drew their data",
      inputSchema: reportAppStatusSchema.shape,
      annotations: {
        title: "Report App Status",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["app"],
        },
      },
    },
    async (params: z.infer<typeof reportAppStatusSchema>, extra) => {
      const fields = {
        ...params,
        ...(params.error && { error: withoutApiKey(params.error) }),
        ...callerForLog(server, extra),
      };
      if (params.status === "failed") logger.warn(fields, "App failed");
      else logger.info(fields, "App drawn");
      return { content: [{ type: "text" as const, text: "ok" }] };
    }
  );

  return () => {
    apiKeyTool.remove();
    appConfigTool.remove();
    appDataTool.remove();
    appStatusTool.remove();
  };
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

function unavailable() {
  return {
    content: [{ type: "text" as const, text: "App data unavailable" }],
    isError: true,
  };
}
