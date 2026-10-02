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
import { logger } from "./logger";

export type UpstreamCall = "uls-api-key" | "uls-token-exchange" | "account-api";

/**
 * Performs an HTTP call under a hard deadline, composed with any signal the
 * caller already passed.
 *
 * Returns the response, HTTP errors included, for the caller to classify.
 * Throws the original error when no response arrived at all, logged once here
 * with the call identity and the deadline that applied.
 */
export async function fetch(
  call: UpstreamCall,
  url: string,
  init: RequestInit = {},
  context: Record<string, unknown> = {}
): Promise<Response> {
  try {
    return await globalThis.fetch(url, { ...init, signal: withDeadline(init.signal) });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    logger.error(
      { ...context, call, url, timeoutMs: UPSTREAM_REQUEST_TIMEOUT_MS, error },
      timedOut ? "Upstream request timed out" : "Upstream request failed"
    );
    throw error;
  }
}

function withDeadline(signal: AbortSignal | null | undefined): AbortSignal {
  const deadline = AbortSignal.timeout(UPSTREAM_REQUEST_TIMEOUT_MS);
  return signal == null ? deadline : AbortSignal.any([signal, deadline]);
}
