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

import { logger } from "../utils/logger";

export interface TokenExchangerConfig {
  /** ULS token endpoint URL (e.g. https://oauth.my.tomtom.com/token) */
  tokenEndpoint: string;
  /** Client ID identifying this app to ULS */
  clientId: string;
  /** Target audience for the exchanged token (e.g. https://account.cx.tomtom.com) */
  audience: string;
  /** Scope requested for the exchanged token (e.g. authorize) */
  scope: string;
}

interface TokenExchangeResponse {
  access_token: string;
  issued_token_type: string;
  token_type: string;
  expires_in?: number;
}

interface TokenExchangeErrorResponse {
  error: string;
  error_description?: string;
}

/**
 * Exchanges a user's access token for one scoped to a different audience
 * (e.g. the account management API) via the ULS token exchange endpoint.
 *
 * Uses RFC 8693 Token Exchange:
 * - grant_type: urn:ietf:params:oauth:grant-type:token-exchange
 * - subject_token_type: urn:ietf:params:oauth:token-type:jwt
 * - requested_token_type: urn:ietf:params:oauth:token-type:access_token
 */
export class TokenExchanger {
  private readonly tokenEndpoint: string;
  private readonly clientId: string;
  private readonly audience: string;
  private readonly scope: string;

  constructor(config: TokenExchangerConfig) {
    this.tokenEndpoint = config.tokenEndpoint;
    this.clientId = config.clientId;
    this.audience = config.audience;
    this.scope = config.scope;
  }

  async exchangeToken(bearerToken: string): Promise<string | null> {
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: bearerToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      audience: this.audience,
      scope: this.scope,
      client_id: this.clientId,
    });

    logger.debug(
      { endpoint: this.tokenEndpoint, audience: this.audience },
      "Token exchange request"
    );

    const response = await fetch(this.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorBody = (await response
        .json()
        .catch(() => null)) as TokenExchangeErrorResponse | null;
      logger.error(
        {
          status: response.status,
          audience: this.audience,
          error: errorBody?.error,
          errorDescription: errorBody?.error_description,
        },
        "Token exchange failed"
      );
      return null;
    }

    const result = (await response.json()) as TokenExchangeResponse;
    return result.access_token ?? null;
  }
}
