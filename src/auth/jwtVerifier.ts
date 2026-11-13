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

import {
  createRemoteJWKSet,
  customFetch,
  decodeJwt,
  type JWTPayload,
  type JWTVerifyGetKey,
  jwtVerify,
} from "jose";
import { ErrorWithData } from "../types/types";
import { fetch } from "../utils/http";
import { kindForStatus } from "../utils/apiErrorHandler";
import { logger } from "../utils/logger";

const ALLOWED_ALGORITHMS = ["ES256", "RS256"];

export interface JwtIssuerConfig {
  jwksUri: string;
  expectedIssuer: string;
}

export interface JwtVerifierConfig {
  issuers: JwtIssuerConfig[];
  audiences: string[];
}

async function fetchSigningKeys(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch("entra-jwks", url, init);
  if (response.ok) return response;
  const kind = kindForStatus(response.status);
  const failure = new kind(
    "Entra did not hand out its signing keys",
    { status: response.status },
    { upstream: "entra-jwks" }
  );
  logger.error(
    { upstream: "entra-jwks", errorKind: failure.name, status: response.status, url },
    "Upstream call failed"
  );
  throw failure;
}

export class JwtVerifier {
  private readonly jwksByIssuer: Map<string, JWTVerifyGetKey>;
  private readonly audiences: string[];

  constructor(config: JwtVerifierConfig) {
    if (config.issuers.length === 0) {
      throw new Error("JwtVerifier requires at least one issuer");
    }
    this.jwksByIssuer = new Map(
      config.issuers.map((i) => [
        i.expectedIssuer,
        createRemoteJWKSet(new URL(i.jwksUri), { [customFetch]: fetchSigningKeys }),
      ])
    );
    this.audiences = config.audiences;
  }

  async verifyBearerToken(
    token: string | null
  ): Promise<{ valid: boolean; reason?: string; payload?: JWTPayload }> {
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
      const { payload } = await jwtVerify(token, jwks, {
        issuer: iss,
        algorithms: ALLOWED_ALGORITHMS,
        audience: this.audiences,
      });
      return { valid: true, payload };
    } catch (error) {
      if (error instanceof ErrorWithData) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn({ reason }, "Bearer token verification failed");
      return { valid: false, reason };
    }
  }
}
