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

import { afterEach, describe, expect, it, vi } from "vitest";
import { UlsApiKeyResolver } from "./ulsApiKeyResolver";

const CONFIG = {
  ulsTokenEndpoint: "https://uls.test.example/token",
  clientId: "https://mcp.test.example",
  resource: "https://api.test.example",
};

function stubExchange(response: { body: unknown; status?: number }) {
  const mockFetch = vi.fn(
    async () => new Response(JSON.stringify(response.body), { status: response.status ?? 200 })
  );
  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

function sentParams(mockFetch: ReturnType<typeof vi.fn>): URLSearchParams {
  const [, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
  return new URLSearchParams(String(init.body));
}

describe("UlsApiKeyResolver", () => {
  const resolver = new UlsApiKeyResolver(CONFIG);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exchanges without a scope when no project is given", async () => {
    const mockFetch = stubExchange({
      body: {
        access_token: "api-key-1",
        issued_token_type: "urn:tomtom:uls:params:oauth:token-type:api_key",
        token_type: "N_A",
      },
    });

    await expect(resolver.resolveApiKey("user-token")).resolves.toBe("api-key-1");
    expect(sentParams(mockFetch).get("scope")).toBeNull();
  });

  it("scopes the key to the project and product bundle via scope URNs", async () => {
    const mockFetch = stubExchange({
      body: {
        access_token: "api-key-2",
        issued_token_type: "urn:tomtom:uls:params:oauth:token-type:api_key",
        token_type: "N_A",
      },
    });

    await expect(
      resolver.resolveApiKey("user-token", { projectId: "project-uuid", bundleId: "bundle-uuid" })
    ).resolves.toBe("api-key-2");

    expect(sentParams(mockFetch).get("scope")).toBe(
      "urn:tomtom:my:params:project:project-uuid urn:tomtom:my:params:product_bundle:bundle-uuid"
    );
  });

  it("returns null when ULS denies the scoped exchange", async () => {
    stubExchange({
      body: { error: "access_denied", error_description: "no write permission on project" },
      status: 403,
    });

    await expect(
      resolver.resolveApiKey("user-token", { projectId: "project-uuid", bundleId: "bundle-uuid" })
    ).resolves.toBeNull();
  });
});
