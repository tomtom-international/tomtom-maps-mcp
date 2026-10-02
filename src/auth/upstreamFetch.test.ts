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
import { UPSTREAM_REQUEST_TIMEOUT_MS } from "../constants";
import { logger } from "../utils/logger";
import { upstreamFetch } from "./upstreamFetch";

const URL = "https://upstream.test.example/token";
const CALL = "uls-api-key";

function timeoutError(): Error {
  const error = new Error("The operation was aborted due to timeout");
  error.name = "TimeoutError";
  return error;
}

describe("upstreamFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns the response and attaches an abort signal", async () => {
    const mockFetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    const response = await upstreamFetch(CALL, URL, { method: "POST", body: "a=1" });

    expect(response?.status).toBe(200);
    const [url, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL);
    expect(init.method).toBe("POST");
    expect(init.body).toBe("a=1");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("hands back an HTTP error for the caller to classify", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 }))
    );

    const response = await upstreamFetch(CALL, URL, { method: "POST" });

    expect(response?.status).toBe(503);
  });

  it("returns null when the deadline expires", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw timeoutError();
      })
    );

    await expect(upstreamFetch(CALL, URL, { method: "POST" })).resolves.toBeNull();
  });

  it("returns null when the connection fails outright", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    await expect(upstreamFetch(CALL, URL, { method: "POST" })).resolves.toBeNull();
  });

  it("applies the shared deadline to the request", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const mockFetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    await upstreamFetch(CALL, URL, { method: "POST" });

    expect(timeoutSpy).toHaveBeenCalledWith(UPSTREAM_REQUEST_TIMEOUT_MS);
    const [, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBe(timeoutSpy.mock.results[0]?.value);
  });

  it("names the call and the request in the failure log", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw timeoutError();
      })
    );

    await upstreamFetch("uls-token-exchange", URL, { method: "POST" }, { requestId: "req-9" });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        call: "uls-token-exchange",
        requestId: "req-9",
        url: URL,
        timeoutMs: UPSTREAM_REQUEST_TIMEOUT_MS,
      }),
      "Upstream request timed out"
    );
  });
});
