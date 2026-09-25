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
import { logger } from "./utils/logger";
import { isHttpMode, validateApiKey } from "./services/base/tomtomClient";
import { createAppTools } from "./tools/appTools";
import { createMapOrbisTools } from "./tools/mapOrbisTools";
import { createSearchOrbisTools } from "./tools/searchOrbisTools";
import { createRoutingOrbisTools } from "./tools/routingOrbisTools";
import { createTrafficOrbisTools } from "./tools/trafficOrbisTools";
import { createDataVizOrbisTools } from "./tools/dataVizOrbisTools";
import { VERSION } from "./version";

export const SERVER_NAME = "TomTom Maps MCP Server";

const LEGACY_BACKEND_VALUES = new Set(["tomtom-maps", "tomtom-orbis-maps"]);

/**
 * Creates an MCP server instance with every TomTom tool registered.
 */
export async function createServer(): Promise<McpServer> {
  logger.debug({ server_name: SERVER_NAME }, "Initializing MCP server");

  // In HTTP mode the key is resolved per-request, so skip startup validation.
  // Otherwise validate the static key from appConfig.
  if (!isHttpMode) {
    validateServerApiKey();
  }

  const server = new McpServer({
    name: SERVER_NAME,
    version: VERSION,
  });

  // Note: Session-specific API key context is managed at the HTTP request level
  // using AsyncLocalStorage for proper isolation between concurrent sessions

  await registerTools(server);

  logger.debug({ server_name: SERVER_NAME }, "MCP server initialized with all tools");
  return server;
}

/**
 * The `MAPS` environment variable is deprecated and ignored. Entry points call
 * this once at startup so operators who still set it are told it has no effect.
 */
export function warnIfMapsBackendSet(mapsEnv: string | undefined = process.env.MAPS): void {
  const normalized = mapsEnv?.trim().toLowerCase();
  if (normalized && LEGACY_BACKEND_VALUES.has(normalized)) {
    logger.warn(
      { maps: normalized },
      "The MAPS environment variable is deprecated and ignored: the server always uses the TomTom Orbis Maps APIs"
    );
  }
}

/**
 * Validates API key at startup (from environment)
 */
function validateServerApiKey(): void {
  try {
    validateApiKey();
    logger.debug("TomTom API key validated successfully");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "API key validation failed");
    logger.warn("Server will start but API calls may fail without valid credentials");
  }
}

/**
 * Registers all tools with the server
 */
async function registerTools(server: McpServer): Promise<void> {
  // App-internal tools used by the MCP apps
  createAppTools(server);

  await createSearchOrbisTools(server);
  await createRoutingOrbisTools(server);
  await createTrafficOrbisTools(server);
  await createMapOrbisTools(server);
  await createDataVizOrbisTools(server);
}
