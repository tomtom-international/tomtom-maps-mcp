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

import { describe, expect, it } from "vitest";
import {
  buildTestAuthorizeClientDocument,
  buildTestAuthorizeClientUrl,
} from "./testClientMetadata";

describe("buildTestAuthorizeClientUrl", () => {
  it("joins base URL and document path without a base path", () => {
    expect(buildTestAuthorizeClientUrl("http://localhost:3000", "")).toBe(
      "http://localhost:3000/inspector-client.json"
    );
  });

  it("places the document under the base URL path, not under .well-known", () => {
    expect(buildTestAuthorizeClientUrl("https://mcp-dev.api-system.tomtom.com", "/maps")).toBe(
      "https://mcp-dev.api-system.tomtom.com/maps/inspector-client.json"
    );
  });
});

describe("buildTestAuthorizeClientDocument", () => {
  it("sets client_id to the given URL (CIMD byte-equality)", () => {
    const url = "https://mcp-dev.api-system.tomtom.com/maps/inspector-client.json";
    expect(buildTestAuthorizeClientDocument(url).client_id).toBe(url);
  });

  it("publishes exactly the allow-listed fields", () => {
    const url = "https://mcp-dev.api-system.tomtom.com/maps/inspector-client.json";
    expect(buildTestAuthorizeClientDocument(url)).toEqual({
      client_id: url,
      client_name: "TomTom Maps MCP test client",
      redirect_uris: [
        "http://localhost:6274/oauth/callback",
        "http://127.0.0.1:6274/oauth/callback",
        "http://localhost:6274/oauth/callback/debug",
        "http://127.0.0.1:6274/oauth/callback/debug",
        "http://127.0.0.1:8976/cb",
      ],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "openid email offline_access",
    });
  });

  it("is an authorization-code client, never a token-exchange client", () => {
    const doc = buildTestAuthorizeClientDocument("https://example.tomtom.com/x.json");
    expect(doc.grant_types).not.toContain("urn:ietf:params:oauth:grant-type:token-exchange");
  });
});
