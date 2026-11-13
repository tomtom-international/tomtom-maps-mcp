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

import { generateKeyPair } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type AppConfig, getAppConfig } from "../appConfig";
import {
  ENDPOINT_MCP,
  ENDPOINT_OAUTH_CLIENT_METADATA,
  ENDPOINT_OAUTH_PROTECTED_RESOURCE,
} from "../constants";
import { createHttpServer, type HttpServerResult } from "../indexHttp";
import { FaultError } from "../types/types";
import { logger } from "../utils/logger";
import {
  generateTestKeyPair,
  makeJwksResponse,
  resolveUrl,
  signTestJwt,
  TEST_AUDIENCE,
  TEST_JWKS_URI,
} from "./authTestUtils";
import { buildClientMetadataUrl } from "./clientMetadata";

describe("HTTP Server Integration - Authentication", () => {
  let serverResult: HttpServerResult;
  let appConfig: AppConfig;

  beforeAll(async () => {
    vi.stubGlobal("fetch", createMockFetch());
    process.env.CIAM_TENANT_ID = "test-tenant-id";
    process.env.CIAM_DOMAIN = "test";
    process.env.OAUTH_AUDIENCE = TEST_AUDIENCE;
    process.env.AUTHORIZATION_SERVER_URL = "https://test-auth-server.example.com";
    process.env.ULS_TOKEN_ENDPOINT = ULS_TOKEN_ENDPOINT;

    serverResult = await createHttpServer({
      port: TEST_PORT,
    });
    appConfig = getAppConfig();
  });

  afterAll(async () => {
    await serverResult.shutdown();
    vi.restoreAllMocks();
  });

  it("returns OAuth protected resource metadata", async () => {
    const metadata = await getOAuthProtectedResource();

    expect(metadata.resource).toBe(`${appConfig.baseUrl}${appConfig.baseUrlPath}`);
    expect(metadata.authorization_servers).toEqual(["https://test-auth-server.example.com"]);
    expect(metadata.scopes_supported).toEqual(["mcp:tools", "mcp:resources"]);
  });

  it("returns the OAuth client ID metadata document with client_id matching its own URL", async () => {
    const response = await fetch(
      `http://localhost:${TEST_PORT}/${ENDPOINT_OAUTH_CLIENT_METADATA}${appConfig.baseUrlPath}`
    );
    const document = await response.json();

    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(document).toEqual({
      client_id: buildClientMetadataUrl(appConfig.baseUrl, appConfig.baseUrlPath),
      client_name: "TomTom Maps MCP Server",
      grant_types: ["urn:ietf:params:oauth:grant-type:token-exchange"],
      token_endpoint_auth_method: "none",
    });
  });

  it("unauthorized request returns 401", async () => {
    const response = await postMcpListTools({ authorization: null, apiKey: null });
    expect(response.status).toBe(401);
    expect(response.headers.get("tracking-id")).toBeTruthy();
  });

  it.each(["request-1", 0, 7])("answers a rejected request with the id it sent, %j", async (id) => {
    const response = await postUnauthenticatedWithId(id);
    expect(response.status).toBe(401);
    expect(response.body.id).toBe(id);
  });

  it.each([{ "<script>": "alert(1)" }, ["request-1"], true])(
    "answers a rejected request with a null id when its id is not a string or number, %j",
    async (id) => {
      const response = await postUnauthenticatedWithId(id);
      expect(response.status).toBe(401);
      expect(response.body.id).toBeNull();
    }
  );

  it("logs a request it refused without a token, as an OAuth request", async () => {
    const info = vi.spyOn(logger, "info");

    await postMcpListTools({ authorization: null, apiKey: null });

    await vi.waitFor(() =>
      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({ method: "tools/list", status: 401, auth: "oauth" }),
        "Request completed"
      )
    );
    info.mockRestore();
  });

  it("malformed Bearer token returns 401", async () => {
    const response = await postMcpListTools({ authorization: "Bearer not-a-jwt", apiKey: null });
    expect(response.status).toBe(401);
    const wwwAuth = response.headers.get("www-authenticate");
    expect(wwwAuth).toMatch(/^Bearer /);
    expect(wwwAuth).toContain(
      `resource_metadata="${appConfig.baseUrl}/${ENDPOINT_OAUTH_PROTECTED_RESOURCE}${appConfig.baseUrlPath}"`
    );
    expect(wwwAuth).toContain(`error="invalid_token"`);
    expect(wwwAuth).toContain("error_description=");
  });

  it("refuses with 403 when ULS will not exchange the token for a key", async () => {
    const response = await postMcp({
      authorization: `Bearer ${SIGNED_BEARER_TOKEN}`,
      method: "tools/call",
      params: { name: "tomtom-geocode", arguments: { query: "Amsterdam" } },
    });
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body).error).toEqual({
      code: -32001,
      message: "Your account may not get an API key for this server: ask its owner for access.",
    });
    expect(response.body).not.toMatch(/invalid_grant|subject_token/);
  });

  it("logs the refused request once, with what failed", async () => {
    const warn = vi.spyOn(logger, "warn");

    await postMcp({
      authorization: `Bearer ${SIGNED_BEARER_TOKEN}`,
      method: "tools/call",
      params: { name: "tomtom-geocode", arguments: { query: "Amsterdam" } },
    });

    expect(warn).toHaveBeenCalledWith(
      {
        status: 403,
        outcome: "upstream_error",
        errorKind: "ForbiddenError",
        upstream: "uls-api-key",
      },
      "Request refused"
    );
    warn.mockRestore();
  });

  it("serves the tool list and app templates to a valid token without a ULS exchange", async () => {
    ulsCalls = 0;
    const tools = await postMcpListTools({ authorization: `Bearer ${SIGNED_BEARER_TOKEN}` });
    const template = await postMcp({
      authorization: `Bearer ${SIGNED_BEARER_TOKEN}`,
      method: "resources/read",
      params: { uri: "ui://tomtom-map/places-and-routes/app.html" },
    });

    expect(tools.status).toBe(200);
    expect(tools.body).toContain("tomtom-geocode");
    expect(template.status).toBe(200);
    expect(ulsCalls).toBe(0);
  });

  it("still verifies the token of a request that needs no API key", async () => {
    const response = await postMcp({
      authorization: "Bearer not-a-jwt",
      method: "resources/read",
      params: { uri: "ui://tomtom-map/places-and-routes/app.html" },
    });
    expect(response.status).toBe(401);
  });

  it("rejects a Bearer token issued for another audience with a challenge", async () => {
    const otherAudienceToken = await signTestJwt(TEST_PRIVATE_KEY, {
      issuer: "https://test-tenant-id.ciamlogin.com/test-tenant-id/v2.0",
      audience: "another-tomtom-app",
    });
    const response = await postMcpListTools({
      authorization: `Bearer ${otherAudienceToken}`,
      apiKey: null,
    });
    expect(response.status).toBe(401);
    const wwwAuth = response.headers.get("www-authenticate");
    expect(wwwAuth).toContain(`error="invalid_token"`);
    expect(wwwAuth).toMatch(/aud/);
  });

  it("rejects a Bearer token signed with a different key", async () => {
    const { privateKey: wrongKey } = await generateKeyPair("ES256");
    const wronglySignedToken = await signTestJwt(wrongKey);
    const response = await postMcpListTools({
      authorization: `Bearer ${wronglySignedToken}`,
      apiKey: null,
    });
    expect(response.status).toBe(401);
  });

  it("accepts a valid api key", async () => {
    const response = await postMcpListTools({ apiKey: TEST_API_KEY });
    expect(response.ok).toBe(true);
  });
});

describe("HTTP Server Integration - Entra cannot hand out its signing keys", () => {
  let server: HttpServerResult;

  beforeAll(async () => {
    entraKeysDown = true;
    server = await createHttpServer({ port: ENTRA_DOWN_PORT });
  });

  afterAll(async () => {
    entraKeysDown = false;
    await server.shutdown();
  });

  it("answers 503 with a retry time, not a challenge to sign in again", async () => {
    const response = await postMcp({
      authorization: `Bearer ${SIGNED_BEARER_TOKEN}`,
      method: "tools/list",
      port: ENTRA_DOWN_PORT,
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(JSON.parse(response.body).error.message).toBe(
      "Sign-in is unavailable right now: retry later."
    );
  });
});

describe("HTTP Server Integration - OAuth without OAUTH_AUDIENCE", () => {
  it("refuses to start", async () => {
    const previous = process.env.OAUTH_AUDIENCE;
    process.env.CIAM_TENANT_ID = "test-tenant-id";
    process.env.CIAM_DOMAIN = "test";
    delete process.env.OAUTH_AUDIENCE;
    try {
      const startup = createHttpServer({ port: TEST_PORT + 1 });
      await expect(startup).rejects.toBeInstanceOf(FaultError);
      await expect(startup).rejects.toThrow(/OAUTH_AUDIENCE is not set/);
    } finally {
      if (previous !== undefined) process.env.OAUTH_AUDIENCE = previous;
    }
  });
});

const TEST_PORT = 3995;
// Its own port: vitest runs the other integration files in parallel, and 3996 to 3998 are theirs
const ENTRA_DOWN_PORT = 3993;
const TEST_API_KEY = "test-api-key";

const { privateKey: TEST_PRIVATE_KEY, publicJwk: TEST_PUBLIC_JWK } = await generateTestKeyPair();
const SIGNED_BEARER_TOKEN = await signTestJwt(TEST_PRIVATE_KEY, {
  issuer: "https://test-tenant-id.ciamlogin.com/test-tenant-id/v2.0",
});

const ULS_TOKEN_ENDPOINT = "https://uls-mock.test.example.com/token";
let ulsCalls = 0;
let entraKeysDown = false;

function createMockFetch() {
  const originalFetch = globalThis.fetch;
  return (input: string | URL | Request, init?: RequestInit) => {
    const url = resolveUrl(input);
    if (
      url === TEST_JWKS_URI ||
      url === "https://test.ciamlogin.com/test-tenant-id/discovery/v2.0/keys"
    ) {
      if (entraKeysDown) return Promise.resolve(new Response("", { status: 503 }));
      return Promise.resolve(makeJwksResponse(TEST_PUBLIC_JWK));
    }
    if (url === ULS_TOKEN_ENDPOINT) {
      ulsCalls++;
      return Promise.resolve(
        new Response(
          JSON.stringify({ error: "invalid_grant", error_description: "invalid subject_token" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        )
      );
    }
    return originalFetch(input, init);
  };
}

async function postMcpListTools(auth: { authorization?: string | null; apiKey?: string | null }) {
  return postMcp({ ...auth, method: "tools/list" });
}

async function postMcp({
  authorization,
  apiKey,
  method,
  params = {},
  port = TEST_PORT,
}: {
  authorization?: string | null;
  apiKey?: string | null;
  method: string;
  params?: Record<string, unknown>;
  port?: number;
}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json,text/event-stream",
    Connection: "close",
  };
  if (apiKey != null) {
    headers["tomtom-api-key"] = apiKey;
  }
  if (authorization != null) {
    headers.Authorization = authorization;
  }

  const response = await fetch(`http://localhost:${port}/${ENDPOINT_MCP}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.text();
  return { status: response.status, ok: response.ok, body, headers: response.headers };
}

async function postUnauthenticatedWithId(id: unknown) {
  const response = await fetch(`http://localhost:${TEST_PORT}/${ENDPOINT_MCP}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Connection: "close" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list" }),
  });
  return { status: response.status, body: await response.json() };
}

async function getOAuthProtectedResource() {
  const response = await fetch(
    `http://localhost:${TEST_PORT}/${ENDPOINT_OAUTH_PROTECTED_RESOURCE}${getAppConfig().baseUrlPath}`
  );
  return response.json();
}
