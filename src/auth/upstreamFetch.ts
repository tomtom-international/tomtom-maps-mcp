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

import { UPSTREAM_REQUEST_TIMEOUT_MS } from "../constants";
import { logger } from "../utils/logger";

/**
 * Performs an upstream auth call under a hard deadline.
 *
 * Returns the response for the caller to classify, or null when no response
 * arrived at all: the deadline expired, DNS failed, or the connection dropped.
 * An HTTP error is a response and is handed back unchanged.
 *
 * Every upstream call in the request path needs a deadline. `fetch` has none by
 * default, so an unanswered call leaves the MCP request open until the client
 * gives up, which the client reports as a timeout while our logs stay silent.
 */
export async function upstreamFetch(
  url: string,
  init: RequestInit,
  context: Record<string, unknown> = {}
): Promise<Response | null> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(UPSTREAM_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    logger.error(
      { ...context, url, timeoutMs: UPSTREAM_REQUEST_TIMEOUT_MS, error },
      timedOut ? "Upstream request timed out" : "Upstream request failed"
    );
    return null;
  }
}
