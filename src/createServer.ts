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
import { type ClientApps, classifyClient, clientForLog } from "./clientApps";
import { isHttpMode, requireApiKey } from "./services/api-key";
import { registerTools } from "./tools/register";
import { logger } from "./utils/logger";
import { VERSION } from "./version";

export const SERVER_NAME = "TomTom Maps MCP Server";

/**
 * Factory function that creates and configures a TomTom MCP server instance.
 *
 * A client known to render no MCP Apps (see classifyClient) gets no map tools,
 * app-only tools, app resources or show_ui: it would show the app-only tools
 * to the model, and a map tool's result, or a data tool's with show_ui, reads
 * as if a map was shown. clientApps is what the caller already knows of the
 * client; otherwise the client's initialize decides, if this server sees one.
 */
export async function createServer(clientApps?: ClientApps): Promise<McpServer> {
  logger.debug({ server_name: SERVER_NAME }, "Initializing MCP server");

  // In HTTP mode the key is resolved per-request, so skip startup validation.
  // Otherwise validate the static key from appConfig.
  if (!isHttpMode) {
    validateServerApiKey();
    warnIfMapsEnvSet();
  }

  // Taking the app parts away after initialize changes many tools and
  // resources at once; the client hears one list_changed for each list.
  const server = new McpServer(
    { name: SERVER_NAME, version: VERSION },
    {
      debouncedNotificationMethods: [
        "notifications/tools/list_changed",
        "notifications/resources/list_changed",
      ],
    }
  );

  const withoutApps = registerTools(server);
  const hideApps = () => {
    for (const hide of withoutApps) hide();
  };
  if (clientApps === "text-only") hideApps();
  server.server.oninitialized = () => {
    const capabilities = server.server.getClientCapabilities();
    if (!capabilities) return;
    const client = server.server.getClientVersion();
    const apps = clientApps ?? classifyClient(capabilities, client);
    logger.info(
      { client: clientForLog(client), apps, appsChosen: clientApps !== undefined },
      "Client initialized"
    );
    if (apps === "text-only" && !clientApps) hideApps();
  };

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

/** MAPS is ignored; warn anyone still setting it. */
export function warnIfMapsEnvSet(env: NodeJS.ProcessEnv = process.env): void {
  if (env.MAPS) {
    logger.warn(
      { MAPS: env.MAPS },
      "MAPS is no longer read; all tools use the TomTom Orbis Maps APIs"
    );
  }
}
