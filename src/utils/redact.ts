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
 *
 * Strips credentials out of an upstream response before anything else sees it.
 *
 * Not hypothetical tidying. The maps SDK echoes the request parameters it was
 * given into the properties of every feature it returns, so a reachable-range
 * result carries `properties.apiKey` holding the real TomTom key — measured, not
 * assumed. The field trimmers happened to drop it on the way to the model, which
 * is why it went unnoticed; nothing dropped it on the way to the dataset store,
 * or to `analyse` code the model wrote.
 *
 * A sandbox handed a credential is a credential-exfiltration path whatever else
 * it denies: Node's permission model does not cover sockets, so a body that can
 * read the key can post it somewhere. Redacting at the boundary removes the
 * exposure instead of relying on every downstream consumer to avoid it.
 */

/**
 * Property names that never belong in a response body.
 *
 * Compared case-insensitively, and deliberately narrow: a rule like "anything
 * containing `key`" would eat legitimate map data, and a redactor that corrupts
 * results is worse than the leak it prevents.
 */
const CREDENTIAL_KEYS = new Set([
  "apikey",
  "api_key",
  "x-api-key",
  "subscriptionkey",
  "authorization",
  "token",
  "bearer",
]);

/** How deep to walk. Responses are wide, not deep; this bounds pathological input. */
const MAX_DEPTH = 12;

/**
 * Returns `value` with every credential-named property removed.
 *
 * Mutates in place and returns the same reference: the caller owns a freshly
 * parsed upstream response, and copying a several-thousand-feature collection to
 * delete two fields is a cost with no benefit.
 */
export function redactCredentials<T>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    for (const item of value) redactCredentials(item, depth + 1);
    return value;
  }

  const record = value as Record<string, unknown>;
  for (const name of Object.keys(record)) {
    if (CREDENTIAL_KEYS.has(name.toLowerCase())) {
      delete record[name];
      continue;
    }
    redactCredentials(record[name], depth + 1);
  }
  return value;
}
