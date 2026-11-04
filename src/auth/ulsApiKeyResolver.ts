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

import { FaultError } from "../types/types";
import { fetch, readJson } from "../utils/http";
import { logger } from "../utils/logger";
import type { McpProject } from "./mcpProjectResolver";
import { fromUlsResponse, type UlsErrorBody } from "./ulsErrors";

const PROJECT_SCOPE_PREFIX = "urn:tomtom:my:params:project:";
const PRODUCT_BUNDLE_SCOPE_PREFIX = "urn:tomtom:my:params:product_bundle:";

export interface UlsApiKeyResolverConfig {
  /** ULS token endpoint URL (e.g. https://test.oauth.my.tomtom.com/token) */
  ulsTokenEndpoint: string;
  /** Client ID identifying this app to ULS */
  clientId: string;
  /** Target resource for the resolved API key */
  resource: string;
}

interface TokenExchangeResponse {
  access_token: string;
  issued_token_type: string;
  token_type: string;
  expires_in?: number;
}

/**
 * Resolves a TomTom API key by exchanging a user's JWT via the ULS token exchange endpoint.
 *
 * Uses RFC 8693 Token Exchange:
 * - grant_type: urn:ietf:params:oauth:grant-type:token-exchange
 * - subject_token_type: urn:ietf:params:oauth:token-type:jwt
 * - requested_token_type: urn:tomtom:uls:params:oauth:token-type:api_key
 */
export class UlsApiKeyResolver {
  private readonly ulsTokenEndpoint: string;
  private readonly clientId: string;
  private readonly resource: string;

  constructor(config: UlsApiKeyResolverConfig) {
    this.ulsTokenEndpoint = config.ulsTokenEndpoint;
    this.clientId = config.clientId;
    this.resource = config.resource;
  }

  /**
   * When mcpProject is given, the key is scoped to that project and product
   * bundle via scope URNs; ULS verifies the user's write permission on the
   * project and denies with invalid_scope otherwise.
   */
  async resolveApiKey(bearerToken: string, mcpProject?: McpProject): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: bearerToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      requested_token_type: "urn:tomtom:uls:params:oauth:token-type:api_key",
      resource: this.resource,
      client_id: this.clientId,
    });
    if (mcpProject != null) {
      body.set(
        "scope",
        `${PROJECT_SCOPE_PREFIX}${mcpProject.projectId} ${PRODUCT_BUNDLE_SCOPE_PREFIX}${mcpProject.bundleId}`
      );
    }

    logger.debug({ endpoint: this.ulsTokenEndpoint }, "ULS token exchange request");

    const response = await fetch("uls-api-key", this.ulsTokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as UlsErrorBody | null;
      throw fromUlsResponse("uls-api-key", response.status, errorBody);
    }
    const result = await readJson<TokenExchangeResponse>("uls-api-key", response);
    if (!result.access_token) {
      throw new FaultError("ULS answered without an API key", {}, { upstream: "uls-api-key" });
    }
    return result.access_token;
  }
}
