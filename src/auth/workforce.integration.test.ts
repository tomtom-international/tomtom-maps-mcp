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

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ENDPOINT_MCP } from "../constants";
import { createHttpServer, type HttpServerResult } from "../indexHttp";
import { logger } from "../utils/logger";
import {
  generateTestKeyPair,
  makeJwksResponse,
  resolveUrl,
  signTestJwt,
  TEST_AUDIENCE,
} from "./authTestUtils";

const TEST_PORT = 3994;
const CIAM_TENANT = "test-tenant-id";
const WORKFORCE_TENANT = "workforce-tenant-id";
const ULS_TOKEN_ENDPOINT = "https://uls-mock.test.example.com/token";
const ACCOUNT_API = "https://account-mock.test.example.com";

const { privateKey, publicJwk } = await generateTestKeyPair();
const WORKFORCE_TOKEN = await signTestJwt(privateKey, {
  issuer: `https://login.microsoftonline.com/${WORKFORCE_TENANT}/v2.0`,
  tenantId: WORKFORCE_TENANT,
});

type AccountApi = "has-mcp-project" | "no-projects" | "down" | "garbled";
let accountApi: AccountApi = "has-mcp-project";
let apiKeyScopes: (string | null)[] = [];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function accountApiAnswer(path: string): Response {
  if (accountApi === "down") return json({ code: "unavailable" }, 503);
  if (accountApi === "garbled") return new Response("<html>Bad gateway</html>", { status: 200 });
  if (path.endsWith("/ListProjects")) {
    return json({ projects: accountApi === "no-projects" ? [] : [{ id: "project-1" }] });
  }
  return json({
    project: {
      id: "project-1",
      bundles: [{ id: "bundle-1", isActive: true, products: [{ info: { code: "MCPServer" } }] }],
    },
  });
}

function stubUpstreams() {
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = resolveUrl(input);
    if (url.includes("/discovery/v2.0/keys")) return Promise.resolve(makeJwksResponse(publicJwk));
    if (url === ULS_TOKEN_ENDPOINT) {
      const params = new URLSearchParams(String(init?.body));
      if (params.get("requested_token_type")?.endsWith(":api_key")) {
        apiKeyScopes.push(params.get("scope"));
        return Promise.resolve(json({ access_token: "freemium-or-scoped-key" }));
      }
      return Promise.resolve(json({ access_token: "account-token" }));
    }
    if (url.startsWith(ACCOUNT_API)) return Promise.resolve(accountApiAnswer(url));
    if (new URL(url).hostname === "localhost") return realFetch(input, init);
    return Promise.resolve(json({}, 500));
  });
}

async function callToolAsWorkforceUser() {
  await fetch(`http://localhost:${TEST_PORT}/${ENDPOINT_MCP}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json,text/event-stream",
      Authorization: `Bearer ${WORKFORCE_TOKEN}`,
      Connection: "close",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "tomtom-geocode", arguments: { query: "Amsterdam" } },
    }),
  }).then((response) => response.text());
}

function lookupLine(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.find((call) => call[1] === "Workforce project lookup")?.[0];
}

describe("A workforce user's project lookup", () => {
  let server: HttpServerResult;

  beforeAll(async () => {
    stubUpstreams();
    process.env.CIAM_TENANT_ID = CIAM_TENANT;
    process.env.CIAM_DOMAIN = "test";
    process.env.WORKFORCE_TENANT_ID = WORKFORCE_TENANT;
    process.env.OAUTH_AUDIENCE = TEST_AUDIENCE;
    process.env.AUTHORIZATION_SERVER_URL = "https://test-auth-server.example.com";
    process.env.ULS_TOKEN_ENDPOINT = ULS_TOKEN_ENDPOINT;
    process.env.ACCOUNT_API_BASE_URL = ACCOUNT_API;
    server = await createHttpServer({ port: TEST_PORT });
  });

  afterAll(async () => {
    await server.shutdown();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    apiKeyScopes = [];
    vi.restoreAllMocks();
  });

  it("scopes the key to the user's MCP project and records it", async () => {
    accountApi = "has-mcp-project";
    const info = vi.spyOn(logger, "info");

    await callToolAsWorkforceUser();

    expect(apiKeyScopes[0]).toContain("project:project-1");
    expect(lookupLine(info)).toMatchObject({ project: "scoped", projectId: "project-1" });
  });

  it("gives a user without an MCP project the freemium key and records why", async () => {
    accountApi = "no-projects";
    const info = vi.spyOn(logger, "info");

    await callToolAsWorkforceUser();

    expect(apiKeyScopes).toEqual([null]);
    expect(lookupLine(info)).toMatchObject({ project: "none", reason: "no-projects" });
  });

  it("gives the freemium key when the lookup failed, recording the upstream that failed", async () => {
    accountApi = "down";
    const warn = vi.spyOn(logger, "warn");

    await callToolAsWorkforceUser();

    expect(apiKeyScopes).toEqual([null]);
    expect(lookupLine(warn)).toMatchObject({
      project: "lookup_failed",
      outcome: "upstream_error",
      upstream: "account-api",
      errorKind: "UnavailableError",
    });
    expect(lookupLine(warn)).not.toHaveProperty("requestId");
  });

  it("gives the freemium key when the Account API answers with a body that is not JSON", async () => {
    accountApi = "garbled";
    const warn = vi.spyOn(logger, "warn");

    await callToolAsWorkforceUser();

    expect(apiKeyScopes).toEqual([null]);
    expect(lookupLine(warn)).toMatchObject({
      project: "lookup_failed",
      upstream: "account-api",
      errorKind: "FaultError",
    });
  });
});
