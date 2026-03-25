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

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generateKeyPair } from "jose";
import { ACCOUNT_API_BASE_URL, APIM_API_BASE_URL, ENDPOINT_MCP, ENDPOINT_OAUTH_PROTECTED_RESOURCE } from "../constants";
import { createHttpServer, type HttpServerResult } from "../indexHttp";
import {
  generateTestKeyPair,
  makeJwksResponse,
  resolveUrl,
  signTestJwt,
  TEST_AUTHORIZATION_SERVER,
  TEST_JWKS_URI,
} from "./authTestUtils";

describe("HTTP Server Integration - Authentication", () => {
  let serverResult: HttpServerResult;

  beforeAll(async () => {
    vi.stubGlobal("fetch", createMockFetch());
    delete process.env.ENTRA_TENANT_ID;

    serverResult = await createHttpServer({
      port: TEST_PORT,
      fixedBackend: null,
      defaultBackend: "tomtom-maps",
      authorizationServer: TEST_AUTHORIZATION_SERVER,
    });
  });

  afterAll(async () => {
    await serverResult.shutdown();
    vi.restoreAllMocks();
  });

  it("returns OAuth protected resource metadata", async () => {
    const metadata = await getOAuthProtectedResource();

    expect(metadata.resource).toBe(`https://mcp.tomtom.com/${ENDPOINT_MCP}`);
    expect(metadata.authorization_servers).toEqual([TEST_AUTHORIZATION_SERVER]);
    expect(metadata.scopes_supported).toEqual(["mcp:tools", "mcp:resources"]);
  });

  it("unauthorized request returns 401", async () => {
    const response = await postMcpListTools({ authorization: null, apiKey: null });
    expect(response.status).toBe(401);
  });

  it("malformed Bearer token returns 401", async () => {
    const response = await postMcpListTools({ authorization: "Bearer not-a-jwt", apiKey: null });
    expect(response.status).toBe(401);
  });

  it("rejects a valid Bearer token when token exchanger is not configured", async () => {
    const response = await postMcpListTools({ authorization: `Bearer ${SIGNED_BEARER_TOKEN}` });
    expect(response.status).toBe(401);
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

const TEST_PORT = 3995;
const TEST_API_KEY = "test-api-key";

const { privateKey: TEST_PRIVATE_KEY, publicJwk: TEST_PUBLIC_JWK } = await generateTestKeyPair();
const SIGNED_BEARER_TOKEN = await signTestJwt(TEST_PRIVATE_KEY);

const TEST_GATEWAY_API_KEY = "test-resolved-api-key";

function createMockFetch() {
  const originalFetch = globalThis.fetch;
  return (input: string | URL | Request, init?: RequestInit) => {
    const url = resolveUrl(input);
    if (url === TEST_JWKS_URI) {
      return Promise.resolve(makeJwksResponse(TEST_PUBLIC_JWK));
    }
    if (url === `${ACCOUNT_API_BASE_URL}/project.v2.ProjectService/ListProjects`) {
      return Promise.resolve(new Response(
        JSON.stringify({ projects: [{ id: "test-project-id", name: "Test Project" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ));
    }
    if (url === `${APIM_API_BASE_URL}/apim.v1.ApplicationService/ListApplications`) {
      return Promise.resolve(new Response(
        JSON.stringify({
          applications: [{
            id: "test-app-id",
            name: "[tomtom-mcp]",
            credentials: [{ apiKey: "masked-key", status: true }],
            projectId: "test-project-id",
          }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ));
    }
    if (url === `${APIM_API_BASE_URL}/apim.v1.ApplicationService/GetApplication`) {
      return Promise.resolve(new Response(
        JSON.stringify({
          application: {
            id: "test-app-id",
            name: "[tomtom-mcp]",
            credentials: [{ apiKey: TEST_GATEWAY_API_KEY, status: true }],
            projectId: "test-project-id",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ));
    }
    return originalFetch(input, init);
  };
}

async function postMcpListTools({
  authorization,
  apiKey,
}: {
  authorization?: string | null;
  apiKey?: string | null;
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
    headers["Authorization"] = authorization;
  }

  const response = await fetch(`http://localhost:${TEST_PORT}/${ENDPOINT_MCP}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const body = await response.text();
  return { status: response.status, ok: response.ok, body };
}

async function getOAuthProtectedResource() {
  const response = await fetch(
    `http://localhost:${TEST_PORT}/${ENDPOINT_OAUTH_PROTECTED_RESOURCE}`
  );
  return response.json();
}
