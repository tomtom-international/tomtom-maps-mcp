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

import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPair } from "jose";
import { JwtVerifier } from "./jwtVerifier";
import { generateTestKeyPair, makeJwksResponse, resolveUrl, signTestJwt, TEST_AUTHORIZATION_SERVER, TEST_JWKS_URI } from "./authTestUtils";

describe("JwtVerifier", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("verifyBearerToken", () => {
    it("returns false for null token", async () => {
      const verifier = new JwtVerifier(TEST_AUTHORIZATION_SERVER);
      expect(await verifier.verifyBearerToken(null)).toBe(false);
    });

    it("returns true for a valid signed JWT", async () => {
      const { privateKey, publicJwk } = await generateTestKeyPair();
      vi.stubGlobal("fetch", mockFetchJwks(publicJwk));

      const verifier = new JwtVerifier(TEST_AUTHORIZATION_SERVER);
      const token = await signTestJwt(privateKey);

      expect(await verifier.verifyBearerToken(token)).toBe(true);
    });

    it("returns false for an expired JWT", async () => {
      const { privateKey, publicJwk } = await generateTestKeyPair();
      vi.stubGlobal("fetch", mockFetchJwks(publicJwk));

      const verifier = new JwtVerifier(TEST_AUTHORIZATION_SERVER);
      const token = await signTestJwt(privateKey, { expirationTime: "0s" });

      expect(await verifier.verifyBearerToken(token)).toBe(false);
    });

    it("returns false for wrong issuer", async () => {
      const { privateKey, publicJwk } = await generateTestKeyPair();
      vi.stubGlobal("fetch", mockFetchJwks(publicJwk));

      const verifier = new JwtVerifier(TEST_AUTHORIZATION_SERVER);
      const token = await signTestJwt(privateKey, { issuer: "https://evil.example.com/" });

      expect(await verifier.verifyBearerToken(token)).toBe(false);
    });

    it("returns false for token signed with a different key", async () => {
      const { publicJwk } = await generateTestKeyPair();
      const { privateKey: wrongKey } = await generateKeyPair("ES256");
      vi.stubGlobal("fetch", mockFetchJwks(publicJwk));

      const verifier = new JwtVerifier(TEST_AUTHORIZATION_SERVER);
      const token = await signTestJwt(wrongKey);

      expect(await verifier.verifyBearerToken(token)).toBe(false);
    });

    it("returns false for completely invalid token string", async () => {
      const { publicJwk } = await generateTestKeyPair();
      vi.stubGlobal("fetch", mockFetchJwks(publicJwk));

      const verifier = new JwtVerifier(TEST_AUTHORIZATION_SERVER);

      expect(await verifier.verifyBearerToken("not-a-jwt")).toBe(false);
    });
  });
});

function mockFetchJwks(publicJwk: object) {
  return vi.fn((input: string | URL | Request) => {
    if (resolveUrl(input) === TEST_JWKS_URI) {
      return Promise.resolve(makeJwksResponse(publicJwk));
    }
    return Promise.resolve(new Response("Not Found", { status: 404 }));
  });
}
