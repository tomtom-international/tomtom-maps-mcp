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

import { ConfidentialClientApplication } from "@azure/msal-node";
import { logger } from "../utils/logger";

export interface TokenExchangerConfig {
  /** CIAM authority host (e.g. tomtomext.ciamlogin.com) */
  ciamAuthorityHost: string;
  /** CIAM tenant ID */
  ciamTenantId: string;
  /** MCP server's app registration client ID */
  clientId: string;
  /** MCP server's app registration client secret */
  clientSecret: string;
  /** Scope for the account API (e.g. https://account.cx.tomtom.com/authorize) */
  accountApiScope: string;
  /** Scope for the APIM API (e.g. https://apim.cx.tomtom.com/authorize) */
  apimApiScope: string;
}

/**
 * Exchanges a user's bearer token for tokens scoped to the account and APIM APIs
 * using the OAuth2 On-Behalf-Of (OBO) flow via Entra ID (MSAL).
 */
export class TokenExchanger {
  private readonly msalClient: ConfidentialClientApplication;
  private readonly accountApiScope: string;
  private readonly apimApiScope: string;

  constructor(config: TokenExchangerConfig) {
    this.accountApiScope = config.accountApiScope;
    this.apimApiScope = config.apimApiScope;

    this.msalClient = new ConfidentialClientApplication({
      auth: {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        authority: `https://${config.ciamAuthorityHost}/${config.ciamTenantId}/`,
        knownAuthorities: [config.ciamAuthorityHost],
      },
    });

    logger.info("TokenExchanger initialized");
  }

  async exchangeForAccountToken(userBearerToken: string): Promise<string | null> {
    return this.exchange(userBearerToken, this.accountApiScope);
  }

  async exchangeForApimToken(userBearerToken: string): Promise<string | null> {
    return this.exchange(userBearerToken, this.apimApiScope);
  }

  private async exchange(userBearerToken: string, scope: string): Promise<string | null> {
    try {
      const result = await this.msalClient.acquireTokenOnBehalfOf({
        oboAssertion: userBearerToken,
        scopes: [scope],
      });
      return result?.accessToken ?? null;
    } catch (error) {
      logger.error({ err: error }, "OBO token exchange failed");
      return null;
    }
  }
}
