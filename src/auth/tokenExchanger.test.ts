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
import { TokenExchanger } from "./tokenExchanger";

const CONFIG = {
  tokenEndpoint: "https://uls.test.example/token",
  clientId: "https://mcp.test.example",
  audience: "https://account.test.example",
  scope: "authorize",
};

describe("TokenExchanger", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts an RFC 8693 token exchange request and returns the access token", async () => {
    const mockFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "exchanged-token",
            issued_token_type: "urn:ietf:params:oauth:token-type:jwt",
            token_type: "Bearer",
            expires_in: 3600,
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", mockFetch);

    const exchanger = new TokenExchanger(CONFIG);
    await expect(exchanger.exchangeToken("user-token")).resolves.toBe("exchanged-token");

    const [url, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CONFIG.tokenEndpoint);
    const params = new URLSearchParams(String(init.body));
    expect(params.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:token-exchange");
    expect(params.get("subject_token")).toBe("user-token");
    expect(params.get("subject_token_type")).toBe("urn:ietf:params:oauth:token-type:jwt");
    expect(params.get("requested_token_type")).toBe(
      "urn:ietf:params:oauth:token-type:access_token"
    );
    expect(params.get("audience")).toBe(CONFIG.audience);
    expect(params.get("scope")).toBe(CONFIG.scope);
    expect(params.get("client_id")).toBe(CONFIG.clientId);
  });

  it("returns null on an OAuth error response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: "invalid_grant", error_description: "expired subject token" }),
            { status: 400 }
          )
      )
    );

    const exchanger = new TokenExchanger(CONFIG);
    await expect(exchanger.exchangeToken("expired-token")).resolves.toBeNull();
  });
});
