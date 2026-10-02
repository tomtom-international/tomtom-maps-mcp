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

import { getUiCapability, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getObjectShape,
  normalizeObjectSchema,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { isHttpMode, requireApiKey } from "./services/base/tomtomClient";
import { createAppTools } from "./tools/appTools";
import { createDataVizTools } from "./tools/dataVizTools";
import { createMapTools } from "./tools/mapTools";
import { createRoutingTools } from "./tools/routingTools";
import { createSearchTools } from "./tools/searchTools";
import { createTrafficTools } from "./tools/trafficTools";
import { logger } from "./utils/logger";
import { VERSION } from "./version";

export const SERVER_NAME = "TomTom Maps MCP Server";

/**
 * Factory function that creates and configures a TomTom MCP server instance
 */
export async function createServer(): Promise<McpServer> {
  logger.debug({ server_name: SERVER_NAME }, "Initializing MCP server");

  // In HTTP mode the key is resolved per-request, so skip startup validation.
  // Otherwise validate the static key from appConfig.
  if (!isHttpMode) {
    validateServerApiKey();
    warnIfMapsEnvSet();
  }

  const server = new McpServer({
    name: SERVER_NAME,
    version: VERSION,
  });

  // Note: Session-specific API key context is managed at the HTTP request level
  // using AsyncLocalStorage for proper isolation between concurrent sessions

  adaptToClientsWithoutApps(server, await registerTools(server));

  logger.debug({ server_name: SERVER_NAME }, "MCP server initialized with all tools");
  return server;
}

/**
 * Validates API key at startup (from environment)
 */
function validateServerApiKey(): void {
  try {
    requireApiKey();
    logger.debug("TomTom API key validated successfully");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "API key validation failed");
    logger.warn("Server will start but API calls may fail without valid credentials");
  }
}

/**
 * MAPS used to choose between two maps backends; tell anyone still setting it
 * that it is ignored.
 */
export function warnIfMapsEnvSet(env: NodeJS.ProcessEnv = process.env): void {
  if (env.MAPS) {
    logger.warn(
      { MAPS: env.MAPS },
      "MAPS is no longer read; all tools use the TomTom Orbis Maps APIs"
    );
  }
}

interface RegisteredTools {
  /** Tools that only serve a client that renders MCP Apps: the app-only tools and the map tools. */
  uiOnly: RegisteredTool[];
  /** Tools that answer with data, some with an optional map widget. */
  data: RegisteredTool[];
}

/**
 * Registers all tools with the server
 */
async function registerTools(server: McpServer): Promise<RegisteredTools> {
  const appOnlyTools = createAppTools(server);

  logger.debug("Registering TomTom Maps tools");
  const data = [
    ...(await createSearchTools(server)),
    ...(await createRoutingTools(server)),
    ...(await createTrafficTools(server)),
  ];
  const mapTools = [await createMapTools(server), await createDataVizTools(server)];

  return { uiOnly: [...appOnlyTools, ...mapTools], data };
}

/**
 * Once a client initializes without the MCP Apps extension, removes the
 * UI-only tools and the data tools' show_ui parameter. Such a client never
 * calls the app-only tools but shows them to the model, and draws no map,
 * while a map tool's result, or a data tool's with show_ui, reads as if a map
 * was shown.
 *
 * A server that never sees initialize, like each stateless HTTP request, has
 * no client capabilities and keeps every tool as it is.
 */
function adaptToClientsWithoutApps(server: McpServer, tools: RegisteredTools): void {
  server.server.oninitialized = () => {
    const capabilities = server.server.getClientCapabilities();
    if (!capabilities) return;
    if (getUiCapability(capabilities)?.mimeTypes?.includes(RESOURCE_MIME_TYPE)) return;

    for (const tool of tools.uiOnly) tool.remove();
    for (const tool of tools.data) {
      const shape = getObjectShape(normalizeObjectSchema(tool.inputSchema));
      if (!shape?.show_ui) continue;
      tool.update({
        paramsSchema: Object.fromEntries(
          Object.entries(shape).filter(([key]) => key !== "show_ui")
        ),
      });
    }
    logger.info(
      { client: server.server.getClientVersion()?.name },
      "Client does not render MCP Apps; removed the map tools, the app-only tools and show_ui"
    );
  };
}
