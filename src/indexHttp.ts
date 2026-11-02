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

import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import compression from "compression";
import cors from "cors";
import express, { type Express, type Request, type Response } from "express";
import { appConfig, getAppConfig } from "./appConfig";
import { buildClientMetadataDocument, buildClientMetadataUrl } from "./auth/clientMetadata";
import { JwtVerifier } from "./auth/jwtVerifier";
import { type McpProject, McpProjectResolver } from "./auth/mcpProjectResolver";
import {
  buildTestAuthorizeClientDocument,
  buildTestAuthorizeClientUrl,
} from "./auth/testClientMetadata";
import { TokenExchanger } from "./auth/tokenExchanger";
import { UlsApiKeyResolver } from "./auth/ulsApiKeyResolver";
import { appsOverride, type ClientApps, classifyClient, clientForLog } from "./clientApps";
import { type ClientSession, clientName, mintSessionId, requestSession } from "./clientSession";
import {
  ENDPOINT_HEALTH,
  ENDPOINT_MCP,
  ENDPOINT_OAUTH_CLIENT_METADATA,
  ENDPOINT_OAUTH_PROTECTED_RESOURCE,
  ENDPOINT_TEST_AUTHORIZE_CLIENT,
  SCOPES_SUPPORTED,
} from "./constants";
import { createServer, warnIfMapsEnvSet } from "./createServer";
import { runWithSessionContext, setHttpMode } from "./services/base/tomtomClient";
import { FaultError } from "./types/types";
import { logger } from "./utils/logger";
import { readVersion } from "./utils/readVersion";
import { registerErrorHandlers } from "./utils/uncaughtErrorHandlers";

registerErrorHandlers();

export interface HttpServerOptions {
  port?: number;
  allowedOrigins?: string;
}

export interface HttpServerResult {
  app: Express;
  httpServer: Server;
  shutdown: () => Promise<void>;
}

/** Returns null if the header is absent or blank. */
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
 * A `resources/read`, which returns an MCP App template: static HTML of up to
 * about 2 MB, which a host such as ChatGPT reads for every app while connecting.
 */
function isResourceRead(req: Request): boolean {
  return req.body?.method === "resources/read";
}

/**
 * Compresses only the app templates. Tool results stay uncompressed: they can
 * hold a secret next to text the caller chose, which is what compression-length
 * attacks such as BREACH need.
 */
function shouldCompress(req: Request, res: Response): boolean {
  return isResourceRead(req) && compression.filter(req, res);
}

/**
 * The methods that never call the TomTom API: an OAuth request made only of
 * these gets no API key, which spares it the ULS exchange.
 */
const KEYLESS_METHODS = new Set([
  "initialize",
  "ping",
  "tools/list",
  "resources/list",
  "resources/templates/list",
  "resources/read",
  "prompts/list",
]);

/**
 * Whether a request body can reach the TomTom API. Anything that is not a
 * known keyless method or a notification, including a JSON-RPC response or an
 * empty batch, counts as needing the key.
 */
export function needsApiKey(body: unknown): boolean {
  const messages = Array.isArray(body) ? body : [body];
  if (messages.length === 0) return true;
  return messages.some((message) => {
    const method = (message as { method?: unknown } | null)?.method;
    if (typeof method !== "string") return true;
    return !KEYLESS_METHODS.has(method) && !method.startsWith("notifications/");
  });
}

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

/**
 * Creates and starts the HTTP server. Exported for integration testing.
 *
 * Each incoming request gets its own McpServer + transport pair, created on-the-fly.
 * This ensures full isolation between concurrent requests — no shared state, no locking.
 * createServer() is lightweight (in-memory tool registration, no network calls).
 */
export async function createHttpServer(options: HttpServerOptions = {}): Promise<HttpServerResult> {
  const config = getAppConfig();
  const { port = appConfig.port, allowedOrigins = appConfig.allowedOrigins } = options;
  const { ciamTenantId, ciamDomain, workforceTenantId, authorizationServerUrl } = config;
  warnIfMapsEnvSet();
  const oauthConfigured = !!(ciamTenantId && ciamDomain);
  if (oauthConfigured && config.oauthAudiences.length === 0) {
    throw new FaultError(
      "OAUTH_AUDIENCE is not set: with CIAM_TENANT_ID and CIAM_DOMAIN configured, bearer tokens must be checked against the audience of this deployment's Entra resource apps. Set OAUTH_AUDIENCE to the comma-separated application IDs.",
      { variable: "OAUTH_AUDIENCE" }
    );
  }

  const resourceMetadataUrl = `${config.baseUrl}/${ENDPOINT_OAUTH_PROTECTED_RESOURCE}${config.baseUrlPath}`;

  const jwtVerifier = oauthConfigured
    ? new JwtVerifier({
        issuers: [
          {
            jwksUri: `https://${ciamDomain}.ciamlogin.com/${ciamTenantId}/discovery/v2.0/keys`,
            expectedIssuer: `https://${ciamTenantId}.ciamlogin.com/${ciamTenantId}/v2.0`,
          },
          ...(workforceTenantId
            ? [
                {
                  jwksUri: `https://login.microsoftonline.com/${workforceTenantId}/discovery/v2.0/keys`,
                  expectedIssuer: `https://login.microsoftonline.com/${workforceTenantId}/v2.0`,
                },
              ]
            : []),
        ],
        audiences: config.oauthAudiences,
      })
    : null;
  const ulsApiKeyResolver = new UlsApiKeyResolver({
    ulsTokenEndpoint: config.ulsTokenEndpoint,
    clientId: config.ulsClientId,
    resource: config.ulsResource,
  });

  const tokenExchanger = new TokenExchanger({
    tokenEndpoint: config.ulsTokenEndpoint,
    clientId: config.ulsClientId,
    audience: config.accountApiAudience,
    scope: config.accountApiScope,
  });

  const mcpProjectResolver = new McpProjectResolver({
    accountApiBaseUrl: config.accountApiBaseUrl,
  });

  const oauth: OAuthDependencies | null = jwtVerifier && {
    jwtVerifier,
    resourceMetadataUrl,
    workforceTenantId,
    tokenExchanger,
    mcpProjectResolver,
  };

  const app = express();
  app.use(express.json());
  // A template goes through in a few large chunks: with zlib's default 16 KB, a
  // 2 MB template took about 0.7 s to compress instead of about 0.1 s.
  app.use(compression({ filter: shouldCompress, chunkSize: 1024 * 1024 }));
  app.use(
    cors({
      origin: allowedOrigins?.split(",") || "*",
      methods: ["POST", "GET", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "tomtom-api-key",
        "mcp-protocol-version",
        "mcp-session-id",
      ],
      exposedHeaders: ["mcp-session-id"],
      maxAge: 86400,
    })
  );

  app.post(`/${ENDPOINT_MCP}`, async (req: Request, res: Response) => {
    const requestId = randomUUID();
    warnIfBackendHeaderSent(req, requestId);
    const apiKey = extractApiKey(req);
    // The token is verified on every request; only the key exchange is skipped
    // for requests that cannot call the TomTom API.
    const keyNeeded = needsApiKey(req.body);
    try {
      let bearer: VerifiedBearer | undefined;
      let mcpProject: McpProject | null = null;
      if (apiKey == null) {
        bearer = await verifyBearer(req, res, oauth);
        if (!bearer) return;
        if (keyNeeded) mcpProject = await resolveWorkforceProject(bearer, oauth, requestId);
      }

      const { sessionId, clientSession, override } = identifyClient(req, requestId);
      logger.debug(
        { requestId, clientName: clientSession.clientName, apps: clientSession.apps },
        "Processing MCP request"
      );
      const server = await createServer(
        override ?? (clientSession.apps === "text-only" ? "text-only" : undefined)
      );
      const transport = await connectTransport(req, res, server, sessionId);

      let resolvedApiKey: string | null | undefined = apiKey;
      if (bearer && keyNeeded) {
        resolvedApiKey = await ulsApiKeyResolver.resolveApiKey(
          bearer.bearerToken,
          mcpProject ?? undefined,
          requestId
        );
        if (resolvedApiKey == null) {
          sendJsonRpcError(res, 502, -32001, "Internal server error", req.body);
          return;
        }
      }

      setUpstreamMetadata(
        res,
        apiKey != null ? "tomtom-api-key" : "oauth",
        clientSession.clientName
      );
      await runWithSessionContext(
        { apiKey: resolvedApiKey ?? undefined, clientName: clientSession.clientName },
        async () => {
          await transport.handleRequest(req, res, req.body);
        }
      );
    } catch (error) {
      logger.error({ requestId, error }, "Request failed");
      if (!res.headersSent) sendJsonRpcError(res, 500, -32603, "Internal server error", req.body);
    }
  });

  // No server-side session to stream on or to end: a session ID only carries what initialize decided.
  app.get(`/${ENDPOINT_MCP}`, (_req: Request, res: Response) => {
    res.status(405).set("Allow", "POST").send("Method Not Allowed");
  });
  app.delete(`/${ENDPOINT_MCP}`, (_req: Request, res: Response) => {
    res.status(405).set("Allow", "POST").send("Method Not Allowed");
  });

  app.get(`/${ENDPOINT_HEALTH}`, (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      version: readVersion(),
    });
  });

  app.get(
    `/${ENDPOINT_OAUTH_PROTECTED_RESOURCE}${config.baseUrlPath}`,
    (_req: Request, res: Response) => {
      res.json({
        resource: `${config.baseUrl}${config.baseUrlPath}`,
        authorization_servers: [authorizationServerUrl],
        scopes_supported: SCOPES_SUPPORTED,
      });
    }
  );

  app.get(
    `/${ENDPOINT_OAUTH_CLIENT_METADATA}${config.baseUrlPath}`,
    (_req: Request, res: Response) => {
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.json(
        buildClientMetadataDocument(buildClientMetadataUrl(config.baseUrl, config.baseUrlPath))
      );
    }
  );

  if (config.testAuthorizeClientEnabled) {
    // Root path, no baseUrlPath prefix: the gateway route rewrites the public
    // prefixed path to this one, while the client_id URL keeps the prefix.
    app.get(`/${ENDPOINT_TEST_AUTHORIZE_CLIENT}`, (_req: Request, res: Response) => {
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json(
        buildTestAuthorizeClientDocument(
          buildTestAuthorizeClientUrl(config.baseUrl, config.baseUrlPath)
        )
      );
    });
  }

  const httpServer = app.listen(port, () => {
    logger.info({ port }, "TomTom MCP HTTP Server started");
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

interface OAuthDependencies {
  jwtVerifier: JwtVerifier;
  resourceMetadataUrl: string;
  workforceTenantId: string | undefined;
  tokenExchanger: TokenExchanger;
  mcpProjectResolver: McpProjectResolver;
}

interface VerifiedBearer {
  bearerToken: string;
  tenantId: unknown;
}

interface RequestClient {
  sessionId?: string; // Minted on /initialize, returned in mcp-session-id, and sent back on every request.
  clientSession: ClientSession;
  override: ClientApps | undefined;
}

function sendJsonRpcError(
  res: Response,
  status: number,
  code: number,
  message: string | undefined,
  body: { id?: unknown } | null | undefined
): void {
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: body?.id || null });
}

function warnIfBackendHeaderSent(req: Request, requestId: string): void {
  const backendHeader = req.headers["tomtom-maps-backend"];
  if (backendHeader) {
    logger.warn(
      { requestId, "tomtom-maps-backend": backendHeader },
      "The tomtom-maps-backend header is no longer read; all tools use the TomTom Orbis Maps APIs"
    );
  }
}

async function verifyBearer(
  req: Request,
  res: Response,
  oauth: OAuthDependencies | null
): Promise<VerifiedBearer | undefined> {
  if (!oauth) {
    const message = "Authentication required: provide a tomtom-api-key header or a Bearer token";
    sendJsonRpcError(res, 401, -32001, message, req.body);
    return undefined;
  }
  const bearerToken = extractBearerToken(req);
  const verification = await oauth.jwtVerifier.verifyBearerToken(bearerToken);
  if (!verification.valid || bearerToken == null) {
    const challenge = { error: "invalid_token", description: verification.reason };
    res.set("WWW-Authenticate", buildWwwAuthenticate(oauth.resourceMetadataUrl, challenge));
    sendJsonRpcError(res, 401, -32001, verification.reason, req.body);
    return undefined;
  }
  return { bearerToken, tenantId: verification.payload?.tid };
}

/** A workforce user's MCP project for the key exchange; null for anyone else or when resolution fails. */
async function resolveWorkforceProject(
  bearer: VerifiedBearer,
  oauth: OAuthDependencies | null,
  requestId: string
): Promise<McpProject | null> {
  if (!oauth || oauth.workforceTenantId == null || bearer.tenantId !== oauth.workforceTenantId) {
    return null;
  }
  let mcpProject: McpProject | null = null;
  try {
    const accountToken = await oauth.tokenExchanger.exchangeToken(bearer.bearerToken, requestId);
    mcpProject =
      accountToken != null
        ? await oauth.mcpProjectResolver.resolveMcpProject(accountToken, requestId)
        : null;
  } catch (error) {
    logger.error({ requestId, error }, "MCP project resolution threw for workforce user");
  }
  if (mcpProject != null) {
    logger.info(
      { requestId, projectId: mcpProject.projectId, bundleId: mcpProject.bundleId },
      "Resolved MCP project for workforce user"
    );
  } else {
    logger.warn({ requestId }, "MCP project resolution failed for workforce user");
  }
  return mcpProject;
}

/**
 * Who sent the request. ?apps= comes with every request; otherwise only
 * initialize shows the client, and the session ID passes on what it showed.
 */
function identifyClient(req: Request, requestId: string): RequestClient {
  const override = appsOverride(req.query.apps);
  if (!isInitializeRequest(req.body)) {
    return {
      clientSession: requestSession(req.header("mcp-session-id"), req.header("user-agent")),
      override,
    };
  }
  const { capabilities, clientInfo } = req.body.params;
  const clientSession: ClientSession = {
    apps: override ?? classifyClient(capabilities, clientInfo),
    clientName: clientName(clientInfo.name),
  };
  logger.info(
    {
      requestId,
      client: clientForLog(clientInfo),
      apps: clientSession.apps,
      appsChosen: override !== undefined,
    },
    "Client initialized"
  );
  return { sessionId: mintSessionId(clientSession), clientSession, override };
}

/**
 * A transport for this request only, closed with the server when the response
 * ends. A template read is answered as plain JSON, which can be compressed: the
 * SSE stream is marked no-transform, and a single resource has nothing to stream.
 */
async function connectTransport(
  req: Request,
  res: Response,
  server: Awaited<ReturnType<typeof createServer>>,
  sessionId: string | undefined
): Promise<StreamableHTTPServerTransport> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: sessionId ? () => sessionId : undefined,
    enableJsonResponse: isResourceRead(req),
  });
  await server.connect(transport);
  res.on("close", () => {
    transport.close();
    server.close();
  });
  return transport;
}

function setUpstreamMetadata(
  res: Response,
  authMethod: "tomtom-api-key" | "oauth",
  clientName: string
): void {
  const metadata = JSON.stringify({ auth_method: authMethod, client: clientName });
  res.setHeader("TomTom-Upstream-Metadata", Buffer.from(metadata).toString("base64"));
}

async function main(): Promise<void> {
  try {
    setHttpMode(getAppConfig().mcpTransportMode);
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
