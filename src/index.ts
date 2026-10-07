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

// Main entry point for the TomTom MCP server
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { appConfig } from "./appConfig";
import { appsOverride } from "./clientApps";
import { createServer } from "./createServer";
import { logger } from "./utils/logger";
import { registerErrorHandlers } from "./utils/uncaughtErrorHandlers";

registerErrorHandlers();

async function start() {
  try {
    const server = await createServer(appsOverride(appConfig.mcpApps));

    const transport = new StdioServerTransport();

    await server.connect(transport);

    logger.info("TomTom MCP server is up and running via stdin/stdout");

    process.on("SIGINT", async () => {
      logger.info("Shutting down gracefully...");
      await server.close();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      logger.info("Shutting down gracefully...");
      await server.close();
      process.exit(0);
    });
  } catch (error) {
    logger.error(
      `Failed to start server: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}

start().catch((error) => {
  logger.error(
    `Startup error: ${error instanceof Error ? error.stack || error.message : String(error)}`
  );
  process.exit(1);
});
