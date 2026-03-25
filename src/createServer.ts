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
import { validateApiKey } from "./services/base/tomtomClient";
import { createAppTools } from "./tools/appTools";
import { createSearchTools } from "./tools/searchTools";
import { createRoutingTools } from "./tools/routingTools";
import { createTrafficTools } from "./tools/trafficTools";
import { createMapTools } from "./tools/mapTools";
import { createMapOrbisTools } from "./tools/mapOrbisTools";
import { createSearchOrbisTools } from "./tools/searchOrbisTools";
import { createRoutingOrbisTools } from "./tools/routingOrbisTools";
import { createTrafficOrbisTools } from "./tools/trafficOrbisTools";
import { createEVRoutingOrbisTools } from "./tools/evRoutingOrbisTools";
import { createDataVizOrbisTools } from "./tools/dataVizOrbisTools";
import { VERSION } from "./version";

/**
 * Configuration interface for server creation
 */
export interface ServerConfig {
  apiKey?: string;
  mapsBackend?: "tomtom-maps" | "tomtom-orbis-maps";
  userAgent?: string;
}

/**
 * Factory function that creates and configures a TomTom MCP server instance
 *
 * @param config Optional configuration. If not provided, uses environment variables
 *
 * Maps Configuration:
 * - config.mapsBackend === "tomtom-orbis-maps" → Uses TomTom Orbis Maps APIs (/maps/orbis/*)
 * - Default → Uses TomTom Maps APIs (standard TomTom APIs)
 *
 * Examples:
 * - createServer({ apiKey: "key", mapsBackend: "tomtom-orbis-maps" }) → TomTom Orbis Maps
 * - createServer() → TomTom Maps from environment variables
 */
export async function createServer(config?: ServerConfig): Promise<McpServer> {
  // Determine configuration source
  let isOrbis: boolean;

  if (config) {
    // Use provided configuration
    isOrbis = config.mapsBackend === "tomtom-orbis-maps";
  } else {
    // Fallback to environment variables (for stdio mode compatibility)
    const mapsEnv = process.env.MAPS?.toLowerCase();
    isOrbis = mapsEnv === "tomtom-orbis-maps";
  }

  const serverName = isOrbis ? "TomTom Orbis Maps MCP Server" : "TomTom Maps MCP Server";

  logger.info(
    { server_name: serverName, maps_backend: isOrbis ? "tomtom-orbis-maps" : "tomtom-maps" },
    "Initializing MCP server"
  );

  // Validate API key if provided in config, otherwise use environment validation
  if (config?.apiKey) {
    validateProvidedApiKey(config.apiKey);
  } else {
    validateServerApiKey();
  }

  const server = new McpServer({
    name: serverName,
    version: VERSION,
  });

  // Note: Session-specific API key context is managed at the HTTP request level
  // using AsyncLocalStorage for proper isolation between concurrent sessions

  // Register all tools
  await registerTools(server, isOrbis);

  logger.info({ server_name: serverName }, "✅ MCP server initialized with all tools");
  return server;
}

/**
 * Validates API key at startup (from environment)
 */
function validateServerApiKey(): void {
  try {
    validateApiKey();
    logger.info("✅ TomTom API key validated successfully");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "❌ API key validation failed");
    logger.warn("Server will start but API calls may fail without valid credentials");
  }
}

/**
 * Validates a provided API key
 */
function validateProvidedApiKey(apiKey: string): void {
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error("API key cannot be empty");
  }
  logger.info("✅ Session-specific TomTom API key provided");
}

/**
 * Registers all tools with the server
 */
async function registerTools(server: McpServer, isOrbis: boolean): Promise<void> {
  // Register app-internal tools (shared across all backends)
  createAppTools(server);

  if (isOrbis) {
    logger.info("Registering TomTom Orbis Maps tools");
    // Register TomTom Orbis Maps tools
    await createSearchOrbisTools(server);
    await createRoutingOrbisTools(server);
    await createTrafficOrbisTools(server);
    await createMapOrbisTools(server);
    await createEVRoutingOrbisTools(server);
    await createDataVizOrbisTools(server);
  } else {
    logger.info("Registering TomTom Maps tools");
    // Register TomTom Maps (standard TomTom) tools
    createSearchTools(server);
    createRoutingTools(server);
    createTrafficTools(server);
    createMapTools(server);
  }
}
