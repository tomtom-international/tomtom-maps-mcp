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
import { appConfig } from "./appConfig";
import { createServer } from "./createServer";
import { logger } from "./utils/logger";
import { randomUUID } from "node:crypto";
import express, { Express, Request, Response } from "express";
import cors from "cors";
import { Server } from "http";
import { runWithSessionContext, setHttpMode } from "./services/base/tomtomClient";
import { readVersion } from "./utils/readVersion";
import { registerErrorHandlers } from "./utils/uncaughtErrorHandlers";

registerErrorHandlers();

export type Backend = "tomtom-orbis-maps" | "tomtom-maps";

export interface HttpServerOptions {
  port?: number;
  fixedBackend?: Backend | null;
  defaultBackend?: Backend;
  allowedOrigins?: string;
  authMethod?: "oauth2" | "api-key";
}

export interface HttpServerResult {
  app: Express;
  httpServer: Server;
  shutdown: () => Promise<void>;
}

// Per JSON-RPC 2.0 spec, request `id` may be a string, number, or null.
// MCP narrows this: `id` must be a string or number (null is not allowed).
type JsonRpcId = string | number;

/**
 * Sends a 401 Unauthorized response with a WWW-Authenticate Bearer challenge.
 */
export function setUnauthorizedInvalidBearerToken(res: Response, id: JsonRpcId): void {
  res
    .status(401)
    .set(
      "WWW-Authenticate",
      `Bearer realm="mcp", resource_metadata="${appConfig.mcpBaseUrl}/.well-known/oauth-protected-resource"`
    )
    .json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id,
    });
}

export function setUnauthorizedInvalidApiKey(res: Response, id: JsonRpcId): void {
  res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Missing or invalid tomtom-api-key header" },
    id: id ?? null,
  });
}

/**
 * Extracts the Bearer token from the Authorization header, or null if absent/malformed.
 */
export function extractBearerToken(req: Request): string | null {
  const auth = req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

/**
 * Returns true if the JWT token's exp claim is in the past.
 * Returns false for non-JWT tokens or tokens without an exp claim.
 */
export function isTokenExpired(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    return typeof payload.exp === "number" && payload.exp * 1000 < Date.now();
  } catch {
    return false;
  }
}

/**
 * Resolves backend configuration from environment variable.
 * Returns the fixed backend if MAPS env is set to a valid value, otherwise null for dual mode.
 */
export function resolveFixedBackend(mapsEnv: string | undefined): Backend | null {
  const normalized = mapsEnv?.toLowerCase();
  return normalized === "tomtom-orbis-maps" || normalized === "tomtom-maps" ? normalized : null;
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
  return normalized === "tomtom-orbis-maps" || normalized === "tomtom-maps"
    ? normalized
    : defaultBackend;
}

/**
 * Creates and starts the HTTP server. Exported for integration testing.
 *
 * Each incoming request gets its own McpServer + transport pair, created on-the-fly.
 * This ensures full isolation between concurrent requests — no shared state, no locking.
 * createServer() is lightweight (in-memory tool registration, no network calls).
 */
export async function createHttpServer(options: HttpServerOptions = {}): Promise<HttpServerResult> {
  const {
    port = appConfig.port,
    fixedBackend = resolveFixedBackend(process.env.MAPS),
    defaultBackend = "tomtom-maps",
    allowedOrigins = appConfig.allowedOrigins,
    authMethod = appConfig.authMethod,
  } = options;

  const app = express();
  app.use(express.json());
  app.use(
    cors({
      origin: allowedOrigins?.split(",") || "*",
      methods: ["POST", "GET", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "tomtom-api-key",
        "tomtom-maps-backend",
        "mcp-protocol-version",
      ],
      maxAge: 86400,
    })
  );

  const availableBackends: Backend[] = fixedBackend
    ? [fixedBackend]
    : ["tomtom-orbis-maps", "tomtom-maps"];

  logger.info(
    {
      mode: fixedBackend ? "fixed" : "dual",
      backends: availableBackends,
      ...(!fixedBackend && { default: defaultBackend }),
    },
    "MCP server configured"
  );

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

      if (authMethod === "oauth2") {
        const bearerToken = extractBearerToken(req);
        if (!bearerToken || isTokenExpired(bearerToken)) {
          setUnauthorizedInvalidBearerToken(res, req.body?.id);
          return;
        }
      } else {
        if (!apiKey?.trim()) {
          setUnauthorizedInvalidApiKey(res, req.body?.id);
          return;
        }
      }

      const backend = getBackend(req);
      if (!availableBackends.includes(backend)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32002, message: `Backend '${backend}' not available` },
          id: req.body?.id || null,
        });
        return;
      }

      logger.debug({ requestId, backend }, "Processing MCP request");

      const server = await createServer({ mapsBackend: backend });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);

      res.on("close", () => {
        transport.close();
        server.close();
      });

      // TODO(LSI-125): Exchange bearer token for API key if authMethod is oauth2.
      await runWithSessionContext(apiKey ?? "", backend, async () => {
        await transport.handleRequest(req, res, req.body);
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
      version: readVersion(),
      mode: fixedBackend ? "fixed" : "dual",
      backends: availableBackends,
      ...(!fixedBackend && { default: defaultBackend }),
    });
  });

  app.get("/.well-known/oauth-protected-resource", (_req: Request, res: Response) => {
    res.json({
      resource: `${appConfig.mcpBaseUrl}/mcp`,
      authorization_servers: [appConfig.authorizationServer],
      scopes_supported: appConfig.scopesSupported,
    });
  });

  const httpServer = app.listen(port, () => {
    logger.info(
      {
        port,
        mode: fixedBackend ? "fixed" : "dual",
        backends: availableBackends,
        ...(!fixedBackend && { default: defaultBackend }),
      },
      "TomTom MCP HTTP Server started"
    );
  });

  const shutdown = async (): Promise<void> => {
    logger.info("Shutting down...");
    return new Promise((resolve) => {
      httpServer.close(() => {
        resolve();
      });
    });
  };

  return { app, httpServer, shutdown };
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
