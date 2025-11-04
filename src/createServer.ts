/*
 * Copyright (C) 2025 TomTom NV
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
import { createSearchTools } from "./tools/searchTools";
import { createRoutingTools } from "./tools/routingTools";
import { createTrafficTools } from "./tools/trafficTools";
import { createMapTools } from "./tools/mapTools";
import { createMapOrbisTools } from "./tools/mapOrbisTools";
import { createSearchOrbisTools } from "./tools/searchOrbisTools";
import { createRoutingOrbisTools } from "./tools/routingOrbisTools";
import { createTrafficOrbisTools } from "./tools/trafficOrbisTools";
import { VERSION } from "./version";

/**
 * Configuration interface for server creation
 */
export interface ServerConfig {
  apiKey?: string;
  mapsBackend?: "genesis" | "orbis";
  userAgent?: string;
}

/**
 * Factory function that creates and configures a TomTom MCP server instance
 *
 * @param config Optional configuration. If not provided, uses environment variables
 *
 * Maps Configuration:
 * - config.mapsBackend === "orbis" → Uses Orbis maps APIs (/maps/orbis/*)
 * - Default → Uses Genesis maps APIs (standard TomTom APIs)
 *
 * Examples:
 * - createServer({ apiKey: "key", mapsBackend: "orbis" }) → Orbis maps
 * - createServer() → Genesis maps from environment variables
 */
export function createServer(config?: ServerConfig): McpServer {
  // Determine configuration source
  let isOrbis: boolean;
  let apiKey: string | undefined;

  if (config) {
    // Use provided configuration
    isOrbis = config.mapsBackend === "orbis";
    apiKey = config.apiKey;
  } else {
    // Fallback to environment variables (for stdio mode compatibility)
    const mapsEnv = process.env.MAPS?.toLowerCase();
    isOrbis = mapsEnv === "orbis";
    apiKey = process.env.TOMTOM_API_KEY;
  }

  const serverName = isOrbis ? "TomTom Orbis MCP Server" : "TomTom Genesis MCP Server";

  logger.info(`Initializing ${serverName} (Maps: ${isOrbis ? "Orbis" : "Genesis"})`);

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
  registerTools(server, isOrbis);

  logger.info(`✅ ${serverName} initialized with all tools`);
  return server;
}

/**
 * Validates API key at startup (from environment)
 */
function validateServerApiKey(): void {
  try {
    validateApiKey();
    logger.info("✅ TomTom API key validated successfully");
  } catch (error: any) {
    logger.error(`❌ API key validation failed: ${error.message}`);
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
function registerTools(server: McpServer, isOrbis: boolean): void {
  if (isOrbis) {
    logger.info("Registering Orbis maps tools");
    // Register Orbis tools
    createSearchOrbisTools(server);
    createRoutingOrbisTools(server);
    createTrafficOrbisTools(server);
    createMapOrbisTools(server);
  } else {
    logger.info("Registering Genesis maps tools");
    // Register Genesis (standard TomTom) tools
    createSearchTools(server);
    createRoutingTools(server);
    createTrafficTools(server);
    createMapTools(server);
  }
}
