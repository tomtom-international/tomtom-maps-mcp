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

import { vi } from "vitest";

/** A request the stubbed fetch received. */
export interface RecordedRequest {
  url: URL;
  body: string;
}

/**
 * Test helper: stubs the global fetch so a test can inspect the requests the
 * SDK builds, offline. Every call answers 200 with `responseBody` as JSON, or
 * with what `responseBody(url)` returns when it is a function.
 * Undo it with `vi.unstubAllGlobals()`.
 */
export function recordFetch(
  responseBody: unknown | ((url: string) => unknown) = {}
): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      requests.push({ url, body: String(init?.body ?? "") });
      const body = typeof responseBody === "function" ? responseBody(url.href) : responseBody;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    })
  );
  return requests;
}
