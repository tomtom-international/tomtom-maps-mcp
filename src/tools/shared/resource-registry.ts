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

import path from "node:path";
import { fileURLToPath } from "node:url";
import { RESOURCE_MIME_TYPE, registerAppResource } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer, RegisteredResource } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "../../utils/logger";
import { APP_CSP } from "./app-csp";
import { readAppHtml } from "./app-html-cache";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Base path for built MCP apps
 * After rolldown bundling, import.meta.url points to dist/index.esm.js
 * so we need ./apps to reach dist/apps/
 */
const APP_BASE_PATH = path.resolve(__dirname, "./apps");

/**
 * Register an MCP App resource from dist/apps
 *
 * @param server - MCP server instance
 * @param resourceUri - URI for the resource (e.g., "ui://tomtom-map/places-and-routes/app.html")
 * @param category - App category directory, e.g. "search"
 * @param appName - App directory name
 */
export function registerAppResourceFromPath(
  server: McpServer,
  resourceUri: string,
  category: string,
  appName: string
): RegisteredResource {
  const htmlPath = path.join(APP_BASE_PATH, category, appName, "app.html");

  return registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      try {
        const html = await readAppHtml(htmlPath);

        return {
          contents: [
            {
              uri: resourceUri,
              mimeType: RESOURCE_MIME_TYPE,
              text: html,
              _meta: { ui: { csp: APP_CSP } },
            },
          ],
        };
      } catch (error) {
        logger.error({ resourceUri, error }, "Failed to load resource");
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
