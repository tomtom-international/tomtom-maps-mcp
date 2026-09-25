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

import { ENDPOINT_OAUTH_CLIENT_METADATA } from "../constants";

/**
 * OAuth Client ID Metadata Document (CIMD,
 * draft-ietf-oauth-client-id-metadata-document) describing this server as an
 * OAuth client to ULS.
 *
 * This is the complete allow-list of published fields — anything not declared
 * here never ships. The document is public by design and must contain no
 * secrets: `token_endpoint_auth_method` is "none" because the server
 * authenticates exchanges with the user's subject_token, not a client
 * credential.
 *
 * `redirect_uris` is deliberately absent: this server is never an
 * authorization-code client (its only grant is token exchange), and ULS
 * dereferences CIMD documents only during redirect-URI validation. Omitting
 * the field makes any authorize attempt under this client_id fail loudly
 * instead of validating against a URI list we would never use. For the
 * token-exchange path the document is currently inert at ULS — the client_id
 * is honored via a ULS client registry entry keyed by this same URL — but it
 * is the identity CIMD requires: `client_id` equals the URL the document is
 * fetched from.
 */
export interface ClientMetadataDocument {
  client_id: string;
  client_name: string;
  grant_types: string[];
  token_endpoint_auth_method: "none";
}

/**
 * URL the client metadata document is served at. CIMD requires the document's
 * `client_id` to equal the exact URL it is fetched from, so this URL is also
 * the server's client_id in ULS token exchanges.
 */
export function buildClientMetadataUrl(baseUrl: string, baseUrlPath: string): string {
  return `${baseUrl}/${ENDPOINT_OAUTH_CLIENT_METADATA}${baseUrlPath}`;
}

export function buildClientMetadataDocument(clientId: string): ClientMetadataDocument {
  return {
    client_id: clientId,
    client_name: "TomTom Maps MCP Server",
    grant_types: ["urn:ietf:params:oauth:grant-type:token-exchange"],
    token_endpoint_auth_method: "none",
  };
}
