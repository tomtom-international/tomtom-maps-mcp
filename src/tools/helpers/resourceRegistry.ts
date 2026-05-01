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
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../../utils/logger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Base path for built MCP apps
 * After rollup bundling, import.meta.url points to dist/index.esm.js
 * so we need ./apps to reach dist/apps/
 */
const APP_BASE_PATH = path.resolve(__dirname, "./apps");

/**
 * Register an MCP App resource from the dist-apps directory
 *
 * @param server - MCP server instance
 * @param resourceUri - URI for the resource (e.g., "ui://tomtom-search/poi-search/app.html")
 * @param category - App category (search, routing, traffic, map)
 * @param appName - App directory name
 */
export async function registerAppResourceFromPath(
  server: McpServer,
  resourceUri: string,
  category: string,
  appName: string
): Promise<void> {
  const htmlPath = path.join(APP_BASE_PATH, category, appName, "app.html");

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      try {
        const html = await fs.readFile(htmlPath, "utf-8");

        return {
          contents: [
            {
              uri: resourceUri,
              mimeType: RESOURCE_MIME_TYPE,
              text: html,
              _meta: {
                ui: {
                  csp: {
                    connectDomains: [
                      "https://api.tomtom.com",
                      "https://*.api.tomtom.com",
                      "https://unpkg.com",
                      "blob:",
                    ],
                    resourceDomains: [
                      "https://unpkg.com",
                      "https://api.tomtom.com",
                      "https://*.api.tomtom.com",
                      "blob:",
                      "data:",
                    ],
                  },
                },
              },
            },
          ],
        };
      } catch (error) {
        logger.error(
          { resourceUri, error: error instanceof Error ? error.message : String(error) },
          "Failed to load resource"
        );
        return {
          contents: [
            {
              uri: resourceUri,
              mimeType: RESOURCE_MIME_TYPE,
              text: `<!DOCTYPE html><html><head><title>Error</title></head><body><p>App not found. Run <code>npm run build:apps</code></p><p>Path: ${htmlPath}</p></body></html>`,
            },
          ],
        };
      }
    }
  );
}
