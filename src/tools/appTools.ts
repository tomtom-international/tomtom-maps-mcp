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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { getEffectiveApiKey } from "../services/base/tomtomClient.js";
import { getVizData } from "../services/cache/vizCache.js";
import { z } from "zod";

const getApiKeySchema = z.object({});

const getVizDataSchema = z.object({
  viz_id: z.string().describe("Unique visualization ID from the tool response _meta"),
});

/**
 * Creates and registers app-internal tools
 * These tools are only visible to apps, not to the LLM
 */
export function createAppTools(server: McpServer): void {
  registerAppTool(
    server,
    "tomtom-get-api-key",
    {
      title: "Get TomTom API Key",
      description: "Internal tool for apps to retrieve the TomTom API key",
      inputSchema: getApiKeySchema as any,
      annotations: { title: "Get TomTom API Key", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
          isError: true
        };
      }

      return {
        content: [{ type: "text" as const, text: apiKey }],
        isError: false
      };
    }
  );

  // Tool for apps to fetch visualization data from cache
  registerAppTool(
    server,
    "tomtom-get-viz-data",
    {
      title: "Get Visualization Data",
      description: "Internal tool for apps to retrieve cached visualization data by viz_id",
      inputSchema: getVizDataSchema as any,
      annotations: { title: "Get Visualization Data", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: {
        ui: {
          visibility: ["app"],
        },
      },
    },
    async (params: { viz_id: string }) => {
      const data = await getVizData(params.viz_id);

      if (data === undefined) {
        return {
          content: [{ type: "text" as const, text: "Visualization data not found or expired" }],
          isError: true
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(data) }],
        isError: false
      };
    }
  );
}
