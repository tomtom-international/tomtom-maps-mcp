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

import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { JWKS_PATH } from "./jwtVerifier";

export const TEST_AUTHORIZATION_SERVER = "https://auth.test.example.com";
export const TEST_JWKS_URI = `${TEST_AUTHORIZATION_SERVER}${JWKS_PATH}`;
const TEST_KID = "test-key";

export async function generateTestKeyPair() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = TEST_KID;
  publicJwk.use = "sig";
  publicJwk.alg = "ES256";
  return { publicKey, privateKey, publicJwk };
}

export async function signTestJwt(
  privateKey: CryptoKey,
  overrides: {
    authorizationServer?: string;
    issuer?: string;
    expirationTime?: string | number;
  } = {}
) {
  const authorizationServer = overrides.authorizationServer ?? TEST_AUTHORIZATION_SERVER;
  return await new SignJWT({ sub: "test-user" })
    .setProtectedHeader({ alg: "ES256", kid: TEST_KID })
    .setIssuedAt()
    .setIssuer(overrides.issuer ?? `${authorizationServer}/`)
    .setExpirationTime(overrides.expirationTime ?? "1h")
    .sign(privateKey);
}

export function makeJwksResponse(publicJwk: object): Response {
  return new Response(JSON.stringify({ keys: [publicJwk] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export function resolveUrl(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}
