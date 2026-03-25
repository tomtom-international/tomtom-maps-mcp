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

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { logger } from "../utils/logger";

export const JWKS_PATH = "/.well-known/jwks.json";
const ALLOWED_ALGORITHMS = ["ES256", "RS256"];

export interface JwtVerifierConfig {
  jwksUri: string;
  expectedIssuer: string;
}

export class JwtVerifier {
  private readonly jwks: JWTVerifyGetKey;
  private readonly expectedIssuer: string;

  constructor(config: string | JwtVerifierConfig) {
    if (typeof config === "string") {
      this.jwks = createRemoteJWKSet(new URL(`${config}${JWKS_PATH}`));
      this.expectedIssuer = `${config}/`;
    } else {
      this.jwks = createRemoteJWKSet(new URL(config.jwksUri));
      this.expectedIssuer = config.expectedIssuer;
    }
  }

  async verifyBearerToken(token: string | null): Promise<boolean> {

    if (token == null) {
      return false;
    }

    try {
      await jwtVerify(token, this.jwks, {
        issuer: this.expectedIssuer,
        algorithms: ALLOWED_ALGORITHMS,
      });

      return true;
    } catch (error) {

      if (error instanceof Error) {
        logger.error({ name: error.name, message: error.message, stack: error.stack }, "Bearer token verification failed");
      } else {
        logger.error({ error: JSON.stringify(error) }, "Bearer token verification failed");
      }
      return false;
    }
  }
}
