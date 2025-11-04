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

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./createServer";
import { logger } from "./utils/logger";
import { randomUUID } from "node:crypto";
import express, { Request, Response } from "express";
import cors from "cors";
import { runWithSessionContext, setHttpMode } from "./services/base/tomtomClient";
import { VERSION } from "./version";

// ============================================================================
// Server Configuration
// ============================================================================

const MAPS_BACKEND = process.env.MAPS?.toLowerCase() === "orbis" ? "orbis" : "genesis";

// ============================================================================
// HTTP Server Implementation
// ============================================================================

async function startHttpServer(): Promise<void> {
  const app = express();
  app.use(express.json());
  // Set CORS with appropriate security headers
  app.use(
    cors({
      origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",") : "*",
      methods: ["POST", "GET"],
      // We expect clients to send the API key in the `tomtom-api-key` header
      allowedHeaders: ["Content-Type", "tomtom-api-key"],
      maxAge: 86400, // 24 hours
    })
  );

  // Create MCP server once at startup (reused for all requests)
  const mcpServer = createServer({ mapsBackend: MAPS_BACKEND });
  logger.info("✅ MCP Server instance created and ready for HTTP requests");

  // Create a single transport for all requests
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // No session IDs for stateless
  });

  // Connect the server to the transport once
  await mcpServer.connect(transport);
  logger.info("✅ MCP Server connected to HTTP transport");

  /**
   * Extract API key from `tomtom-api-key` header (case-insensitive due to express)
   */
  function extractApiKey(req: Request): string | null {
    const headerValue = req.header("tomtom-api-key");
    if (Array.isArray(headerValue)) return null;
    if (!headerValue) return null;
    return headerValue;
  }

  /**
   * Validate API key format
   */
  function validateApiKey(apiKey: string): boolean {
    return !!(apiKey && apiKey.trim().length > 0);
  }

  // Main MCP endpoint
  app.post("/mcp", async (req: Request, res: Response) => {
    const requestId = randomUUID();
    logger.info(`Received MCP request [${requestId}]`);

    // Log request body with some masking for sensitive data
    const logSafeBody = { ...req.body };
    if (logSafeBody.params && typeof logSafeBody.params === "object") {
      // Mask any potentially sensitive fields in params
      if (logSafeBody.params.apiKey) logSafeBody.params.apiKey = "***MASKED***";
    }
    logger.info(`Request body [${requestId}]: ${JSON.stringify(logSafeBody, null, 2)}`);
    try {
        // Extract and validate API key
      const apiKey = extractApiKey(req);

      if (!apiKey) {
        res.status(401).json({
          jsonrpc: "2.0",
          error: {
            code: -32001,
            message: "Unauthorized: Missing API key in tomtom-api-key header",
          },
          id: req.body?.id || null,
        });
        return;
      }

      if (!validateApiKey(apiKey)) {
        res.status(401).json({
          jsonrpc: "2.0",
          error: {
            code: -32001,
            message: "Unauthorized: Invalid API key format",
          },
          id: req.body?.id || null,
        });
        return;
      }

      // Handle request with API key in context
      // This ensures all downstream code has access to the API key via AsyncLocalStorage
      await runWithSessionContext(apiKey, MAPS_BACKEND, async () => {
        await transport.handleRequest(req, res, req.body);
      });

      logger.info(`Request handling completed [${requestId}]`);
    } catch (error) {
      // More detailed error logging
      const errorMessage = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : "No stack trace";
      logger.error(`Error handling request [${requestId}]: ${errorMessage}`);
      logger.debug(`Error stack: ${stack}`);

      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: req.body?.id || null,
        });
      }
    }
  });

  // GET not supported
  app.get("/mcp", async (req: Request, res: Response) => {
    res.status(405).set("Allow", "POST").send("Method Not Allowed");
  });

  // Health check
  app.get("/health", (req: Request, res: Response) => {
    res.json({
      status: "ok",
      backend: MAPS_BACKEND,
      mode: "http",
      version: VERSION
    });
  });

  const PORT = process.env.PORT || 3000;
  const httpServer = app.listen(PORT, () => {
    logger.info(`========================================`);
    logger.info(`TomTom MCP HTTP Server`);
    logger.info(`========================================`);
    logger.info(`Port: ${PORT}`);
    logger.info(`Maps Backend: ${MAPS_BACKEND}`);
    logger.info(`Endpoint: POST http://localhost:${PORT}/mcp`);
    logger.info(`Auth: API key required in 'tomtom-api-key' header`);
    logger.info(`========================================`);
  });

  // Graceful shutdown
  process.on("SIGINT", async () => {
    logger.info("Shutting down HTTP server...");
    httpServer.close(async () => {
      await mcpServer.close();
      process.exit(0);
    });
  });

  process.on("SIGTERM", async () => {
    logger.info("Shutting down HTTP server...");
    httpServer.close(async () => {
      await mcpServer.close();
      process.exit(0);
    });
  });
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function start(): Promise<void> {
  try {
    // Set HTTP mode to use the HTTP-specific user-agent header
    setHttpMode();
    logger.info("Using HTTP-specific User-Agent for TomTom API requests");
    
    await startHttpServer();
  } catch (error) {
    logger.error(
      `Startup error: ${error instanceof Error ? error.stack || error.message : String(error)}`
    );
    process.exit(1);
  }
}

// Start the server
start().catch((error) => {
  logger.error(
    `Critical startup error: ${error instanceof Error ? error.stack || error.message : String(error)}`
  );
  process.exit(1);
});
