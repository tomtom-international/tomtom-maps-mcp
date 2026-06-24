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

import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTVerifyGetKey } from "jose";
import { logger } from "../utils/logger";

const ALLOWED_ALGORITHMS = ["ES256", "RS256"];

export interface JwtIssuerConfig {
  jwksUri: string;
  expectedIssuer: string;
}

export interface JwtVerifierConfig {
  issuers: JwtIssuerConfig[];
}

export class JwtVerifier {
  private readonly jwksByIssuer: Map<string, JWTVerifyGetKey>;

  constructor(config: JwtVerifierConfig) {
    if (config.issuers.length === 0) {
      throw new Error("JwtVerifier requires at least one issuer");
    }
    this.jwksByIssuer = new Map(
      config.issuers.map((i) => [i.expectedIssuer, createRemoteJWKSet(new URL(i.jwksUri))])
    );
  }

  async verifyBearerToken(token: string | null): Promise<{ valid: boolean; reason?: string }> {
    if (token == null) {
      logger.warn("Bearer token verification failed: no token provided");
      return { valid: false, reason: "No bearer token provided" };
    }

    try {
      const { iss } = decodeJwt(token);
      const jwks = iss ? this.jwksByIssuer.get(iss) : undefined;
      if (!jwks) {
        const reason = `Untrusted issuer: ${iss ?? "<missing>"}`;
        logger.warn({ reason }, "Bearer token verification failed");
        return { valid: false, reason };
      }
      await jwtVerify(token, jwks, {
        issuer: iss,
        algorithms: ALLOWED_ALGORITHMS,
      });
      return { valid: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn({ reason }, "Bearer token verification failed");
      return { valid: false, reason };
    }
  }
}
