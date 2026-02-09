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

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "./createServer";
import { logger } from "./utils/logger";
import { randomUUID } from "node:crypto";
import express, { Express, Request, Response } from "express";
import cors from "cors";
import { Server } from "http";
import { runWithSessionContext, setHttpMode } from "./services/base/tomtomClient";
import { VERSION } from "./version";
import { registerErrorHandlers } from "./utils/uncaughtErrorHandlers";

registerErrorHandlers();

export type Backend = "tomtom-orbis-maps" | "tomtom-maps";

interface ServerInstance {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

export interface HttpServerOptions {
  port?: number;
  fixedBackend?: Backend | null;
  defaultBackend?: Backend;
  allowedOrigins?: string;
}

export interface HttpServerResult {
  app: Express;
  httpServer: Server;
  servers: Partial<Record<Backend, ServerInstance>>;
  shutdown: () => Promise<void>;
}

/**
 * Resolves backend configuration from environment variable.
 * Returns the fixed backend if MAPS env is set to a valid value, otherwise null for dual mode.
 */
export function resolveFixedBackend(mapsEnv: string | undefined): Backend | null {
  const normalized = mapsEnv?.toLowerCase();
  return (normalized === "tomtom-orbis-maps" || normalized === "tomtom-maps") ? normalized : null;
}

/**
 * Determines the backend for a request based on fixed config or header.
 */
export function resolveBackendFromHeader(
  fixedBackend: Backend | null,
  headerValue: string | undefined,
  defaultBackend: Backend = "tomtom-maps"
): Backend {
  if (fixedBackend) return fixedBackend;
  const normalized = headerValue?.toLowerCase();
  return (normalized === "tomtom-orbis-maps" || normalized === "tomtom-maps") ? normalized : defaultBackend;
}

async function createMcpInstance(backend: Backend): Promise<ServerInstance> {
  const server = createServer({ mapsBackend: backend });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return { server, transport };
}

/**
 * Creates and starts the HTTP server. Exported for integration testing.
 */
export async function createHttpServer(options: HttpServerOptions = {}): Promise<HttpServerResult> {
  const {
    port = 3000,
    fixedBackend = resolveFixedBackend(process.env.MAPS),
    defaultBackend = "tomtom-maps",
    allowedOrigins = process.env.ALLOWED_ORIGINS,
  } = options;

  const app = express();
  app.use(express.json());
  app.use(
    cors()
    //   {
    //   origin: allowedOrigins?.split(",") || "*",
    //   methods: ["POST", "GET"],
    //   allowedHeaders: ["Content-Type", "tomtom-api-key", "tomtom-maps-backend"],
    //   maxAge: 86400,
    // }
  );

  const servers: Partial<Record<Backend, ServerInstance>> = {};

  if (fixedBackend) {
    servers[fixedBackend] = await createMcpInstance(fixedBackend);
    logger.info({ backend: fixedBackend }, "MCP server initialized (fixed backend mode)");
  } else {
    servers["tomtom-orbis-maps"] = await createMcpInstance("tomtom-orbis-maps");
    servers["tomtom-maps"] = await createMcpInstance("tomtom-maps");
    logger.info({ default: defaultBackend }, "MCP servers initialized (dual backend mode)");
  }

  function getBackend(req: Request): Backend {
    return resolveBackendFromHeader(
      fixedBackend,
      req.header("tomtom-maps-backend"),
      defaultBackend
    );
  }

  app.post("/mcp", async (req: Request, res: Response) => {
    const requestId = randomUUID();

    try {
      const apiKey = req.header("tomtom-api-key");
      if (!apiKey?.trim()) {
        res.status(401).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Missing or invalid tomtom-api-key header" },
          id: req.body?.id || null,
        });
        return;
      }

      const backend = getBackend(req);
      const instance = servers[backend];
      if (!instance) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32002, message: `Backend '${backend}' not available` },
          id: req.body?.id || null,
        });
        return;
      }

      logger.debug({ requestId, backend }, "Processing MCP request");

      await runWithSessionContext(apiKey, backend, async () => {
        await instance.transport.handleRequest(req, res, req.body);
      });
    } catch (error) {
      logger.error(
        { requestId, error: error instanceof Error ? error.message : error },
        "Request failed"
      );
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: req.body?.id || null,
        });
      }
    }
  });

  app.get("/mcp", (_req: Request, res: Response) => {
    res.status(405).set("Allow", "POST").send("Method Not Allowed");
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      version: VERSION,
      mode: fixedBackend ? "fixed" : "dual",
      backends: Object.keys(servers),
      ...(!fixedBackend && { default: defaultBackend }),
    });
  });

  const httpServer = app.listen(port, () => {
    logger.info(
      {
        port,
        mode: fixedBackend ? "fixed" : "dual",
        backends: Object.keys(servers),
        ...(!fixedBackend && { default: defaultBackend }),
      },
      "TomTom MCP HTTP Server started"
    );
  });

  const shutdown = async (): Promise<void> => {
    logger.info("Shutting down...");
    return new Promise((resolve) => {
      httpServer.close(async () => {
        await Promise.all(Object.values(servers).map((s) => s.server.close()));
        resolve();
      });
    });
  };

  return { app, httpServer, servers, shutdown };
}

async function main(): Promise<void> {
  try {
    setHttpMode();
    const port = parseInt(process.env.PORT || "3000", 10);
    const { shutdown } = await createHttpServer({ port });

    process.on("SIGINT", async () => {
      await shutdown();
      process.exit(0);
    });
    process.on("SIGTERM", async () => {
      await shutdown();
      process.exit(0);
    });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.stack : error }, "Startup failed");
    process.exit(1);
  }
}

main();
