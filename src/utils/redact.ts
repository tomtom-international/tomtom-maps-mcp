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
 * Strips credentials out of the app data a tool result inlines, which the host
 * and the MCP app both read.
 *
 * The maps SDK can echo the request parameters it was given into the features
 * it returns, `apiKey` included. The text the model reads is held key-free by
 * the services themselves (`apiKeyLeak.test.ts`); the app data is the untrimmed
 * response, so it is redacted on its way into the result.
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
