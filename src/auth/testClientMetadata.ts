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

import { ENDPOINT_TEST_AUTHORIZE_CLIENT } from "../constants";

/**
 * CIMD document for a TEST authorize client, distinct from this server's own
 * exchange-client identity in clientMetadata.ts. Local test tools (MCP
 * Inspector, token-mint scripts) have no public TomTom-domain home for their
 * client_id, so this deployment lends them one: ULS dereferences the URL at
 * /authorize and Entra requires the client_id origin to be a verified TomTom
 * domain.
 *
 * Served only when TEST_AUTHORIZE_CLIENT_ENABLED is set (dev deployments).
 * The document alone grants nothing — ULS rejects any client_id without a
 * registry entry — but production has no business advertising a login client.
 *
 * `redirect_uris` is the complete allow-list of local callback URLs ULS will
 * accept for this client; adding a tool means adding its callback here.
 */
export interface TestAuthorizeClientDocument {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "none";
  scope: string;
}

const TEST_REDIRECT_URIS = [
  // MCP Inspector callbacks
  "http://localhost:6274/oauth/callback",
  "http://127.0.0.1:6274/oauth/callback",
  "http://localhost:6274/oauth/callback/debug",
  "http://127.0.0.1:6274/oauth/callback/debug",
  // mint-staging-token script callback
  "http://127.0.0.1:8976/cb",
];

/**
 * URL the test client document is served at, and therefore (per CIMD
 * byte-equality) the test client_id itself. Lives under the base URL path to
 * stay namespaced with this product at the API gateway, which routes exact
 * paths only: publishing it needs a gateway route rewriting
 * `{baseUrlPath}/inspector-client.json` to this app's root path, mirroring
 * the existing /maps/health → /health route.
 */
export function buildTestAuthorizeClientUrl(baseUrl: string, baseUrlPath: string): string {
  return `${baseUrl}${baseUrlPath}/${ENDPOINT_TEST_AUTHORIZE_CLIENT}`;
}

export function buildTestAuthorizeClientDocument(clientId: string): TestAuthorizeClientDocument {
  return {
    client_id: clientId,
    client_name: "TomTom Maps MCP test client",
    redirect_uris: TEST_REDIRECT_URIS,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: "openid email offline_access",
  };
}
