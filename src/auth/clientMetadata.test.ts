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
import { buildClientMetadataDocument, buildClientMetadataUrl } from "./clientMetadata";

describe("buildClientMetadataUrl", () => {
  it("joins base URL and well-known path without a base path", () => {
    expect(buildClientMetadataUrl("https://mcp.example.com", "")).toBe(
      "https://mcp.example.com/.well-known/oauth-client-metadata"
    );
  });

  it("appends the base URL path after the well-known segment", () => {
    expect(buildClientMetadataUrl("https://mcp.example.com", "/maps")).toBe(
      "https://mcp.example.com/.well-known/oauth-client-metadata/maps"
    );
  });
});

describe("buildClientMetadataDocument", () => {
  it("sets client_id to the given URL", () => {
    const url = "https://mcp.example.com/.well-known/oauth-client-metadata/maps";
    expect(buildClientMetadataDocument(url).client_id).toBe(url);
  });

  it("publishes exactly the allow-listed fields", () => {
    const doc = buildClientMetadataDocument(
      "https://mcp.example.com/.well-known/oauth-client-metadata"
    );
    expect(doc).toEqual({
      client_id: "https://mcp.example.com/.well-known/oauth-client-metadata",
      client_name: "TomTom Maps MCP Server",
      grant_types: ["urn:ietf:params:oauth:grant-type:token-exchange"],
      token_endpoint_auth_method: "none",
    });
  });
});
