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
import { appConfig, getAppConfig } from "./appConfig";
import {
  ENDPOINT_HEALTH,
  ENDPOINT_MCP,
  ENDPOINT_OAUTH_PROTECTED_RESOURCE,
  SCOPES_SUPPORTED,
} from "./constants";
import { createServer } from "./createServer";
import { logger } from "./utils/logger";
import { randomUUID } from "node:crypto";
import express, { Express, Request, Response } from "express";
import cors from "cors";
import { Server } from "http";
import { runWithSessionContext, setHttpMode } from "./services/base/tomtomClient";
import { readVersion } from "./utils/readVersion";
import { registerErrorHandlers } from "./utils/uncaughtErrorHandlers";
import { JwtVerifier } from "./auth/jwtVerifier";

import { UlsApiKeyResolver } from "./auth/ulsApiKeyResolver";

registerErrorHandlers();

export type Backend = "tomtom-orbis-maps" | "tomtom-maps";

export interface HttpServerOptions {
  port?: number;
  fixedBackend?: Backend | null;
  defaultBackend?: Backend;
  allowedOrigins?: string;
}

export interface HttpServerResult {
  app: Express;
  httpServer: Server;
  shutdown: () => Promise<void>;
}

/**
 * Returns null if token is absent/malformed.
 */
function extractApiKey(req: Request): string | null {
  return req.header("tomtom-api-key")?.trim() || null;
}

/**
 * Returns null if token is absent/malformed.
 */
function extractBearerToken(req: Request): string | null {
  const auth = req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

/**
 * Resolves backend configuration from environment variable.
 * Returns the fixed backend if MAPS env is set to a valid value, otherwise null for dual mode.
 */
/**
 * Builds an RFC 9728 WWW-Authenticate Bearer challenge that points to the
 * MCP server's OAuth protected-resource metadata endpoint. Optional `error`
 * / `description` follow RFC 6750.
 */
export function buildWwwAuthenticate(
  resourceMetadataUrl: string,
  opts: { error?: string; description?: string } = {}
): string {
  const params = [`resource_metadata="${resourceMetadataUrl}"`];
  if (opts.error) params.push(`error="${opts.error}"`);
  if (opts.description) {
    const safe = opts.description.replace(/[^\x20-\x21\x23-\x5B\x5D-\x7E]/g, " ");
    params.push(`error_description="${safe}"`);
  }
  return `Bearer ${params.join(", ")}`;
}

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
  const config = getAppConfig();
  const {
    port = appConfig.port,
    fixedBackend = resolveFixedBackend(process.env.MAPS),
    defaultBackend = "tomtom-maps",
    allowedOrigins = appConfig.allowedOrigins,
  } = options;
  const { ciamTenantId, ciamDomain, authorizationServerUrl } = config;
  const oauthConfigured = !!(ciamTenantId && ciamDomain);

  const resourceMetadataUrl = `${config.baseUrl}/${ENDPOINT_OAUTH_PROTECTED_RESOURCE}`;

  const jwtVerifier = oauthConfigured
    ? new JwtVerifier({
        jwksUri: `https://${ciamDomain}.ciamlogin.com/${ciamTenantId}/discovery/v2.0/keys`,
        expectedIssuer: `https://${ciamTenantId}.ciamlogin.com/${ciamTenantId}/v2.0`,
      })
    : null;

  const ulsApiKeyResolver = new UlsApiKeyResolver({
    ulsTokenEndpoint: config.ulsTokenEndpoint,
  });

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

  logger.debug(
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

  app.post(`/${ENDPOINT_MCP}`, async (req: Request, res: Response) => {
    const requestId = randomUUID();
    const apiKey = extractApiKey(req);
    try {
      if (apiKey == null) {
        if (!oauthConfigured) {
          res.status(401).json({
            jsonrpc: "2.0",
            error: { code: -32001, message: "Authentication required: provide a tomtom-api-key header or a Bearer token" },
            id: req.body?.id || null,
          });
          return;
        }
        const verification = await jwtVerifier!.verifyBearerToken(extractBearerToken(req));
        if (!verification.valid) {
          res
            .set("WWW-Authenticate", buildWwwAuthenticate(resourceMetadataUrl, { error: "invalid_token", description: verification.reason }))
            .status(401)
            .json({
              jsonrpc: "2.0",
              error: { code: -32001, message: verification.reason },
              id: req.body?.id || null,
            });
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

      let resolvedApiKey = apiKey;
      if (resolvedApiKey == null) {
        const bearerToken = extractBearerToken(req)!;
        resolvedApiKey = await ulsApiKeyResolver.resolveApiKey(bearerToken);
        if (resolvedApiKey == null) {
          res.status(502).json({
            jsonrpc: "2.0",
            error: { code: -32001, message: "Failed to resolve API key from token" },
            id: req.body?.id || null,
          });
          return;
        }
      }

      const authMethod = apiKey != null ? "tomtom-api-key" as const : "oauth" as const;
      const metadata = JSON.stringify({ features: [authMethod] });
      res.setHeader("TomTom-Upstream-Metadata", Buffer.from(metadata).toString("base64"));
      await runWithSessionContext(resolvedApiKey, backend, async () => {
        await transport.handleRequest(req, res, req.body);
      });
    } catch (error) {
      logger.error(
        { requestId, error },
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

  app.get(`/${ENDPOINT_MCP}`, (_req: Request, res: Response) => {
    res.status(405).set("Allow", "POST").send("Method Not Allowed");
  });

  app.get(`/${ENDPOINT_HEALTH}`, (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      version: readVersion(),
      mode: fixedBackend ? "fixed" : "dual",
      backends: availableBackends,
      ...(!fixedBackend && { default: defaultBackend }),
    });
  });

  app.get(`/${ENDPOINT_OAUTH_PROTECTED_RESOURCE}`, (_req: Request, res: Response) => {
    res.json({
      resource: `${config.baseUrl}/${ENDPOINT_MCP}`,
      authorization_servers: [authorizationServerUrl],
      scopes_supported: SCOPES_SUPPORTED,
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
