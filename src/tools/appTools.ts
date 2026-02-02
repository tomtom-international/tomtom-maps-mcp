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
import { getEffectiveApiKey } from "../services/base/tomtomClient.js";
import { z } from "zod";

const getApiKeySchema = z.object({});

/**
 * Creates and registers app-internal tools
 * These tools are only visible to apps, not to the LLM
 */
export function createAppTools(server: McpServer): void {
  server.registerTool(
    "tomtom-get-api-key",
    {
      title: "Get TomTom API Key",
      description: "Internal tool for apps to retrieve the TomTom API key",
      inputSchema: getApiKeySchema as any,
      _meta: {
        visibility: ["app"],
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
}
