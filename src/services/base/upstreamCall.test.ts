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

import type { SDKErrorCode } from "@tomtom-org/maps-sdk/core";
import { SDKAbortError, SDKError, SDKServiceError } from "@tomtom-org/maps-sdk/services";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { metricsRegistry } from "../../metrics/metrics";
import { metricValues } from "../../metrics/metricValues";
import {
  BusyError,
  type ErrorWithData,
  FaultError,
  ForbiddenError,
  IncorrectError,
  InterruptedError,
  NotFoundError,
  UnavailableError,
  UnknownError,
} from "../../types/types";
import { toErrorPayload } from "../../utils/apiErrorHandler";
import { logger } from "../../utils/logger";
import { upstreamCall } from "./upstreamCall";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const UPSTREAM_TEXT = "upstream said https://api.tomtom.com/search?key=SECRET-KEY";

const failWith = (error: unknown) => upstreamCall("tomtom-search", () => Promise.reject(error));

const KIND_BY_CODE: [SDKErrorCode, typeof ErrorWithData][] = [
  ["RATE_LIMITED", BusyError],
  ["LIVE_SERVICE_NOT_AVAILABLE", UnavailableError],
  ["NETWORK_NOT_AVAILABLE", UnavailableError],
  ["ABORTED", InterruptedError],
  ["INVALID_CREDENTIALS", ForbiddenError],
  ["INSUFFICIENT_PERMISSIONS", ForbiddenError],
  ["NOT_FOUND", NotFoundError],
  ["INVALID_REQUEST", IncorrectError],
  ["INTERNAL", FaultError],
  ["INSECURE_BASE_URL", UnknownError],
  ["WEBGL_UNSUPPORTED", UnknownError],
  ["WEBGL_CONTEXT_LOST", UnknownError],
  ["STYLE_LOAD_FAILED", UnknownError],
];

describe("upstreamCall", () => {
  beforeEach(() => {
    vi.mocked(logger.error).mockClear();
    metricsRegistry.getSingleMetric("mcp_upstream_duration_seconds")?.reset();
    metricsRegistry.getSingleMetric("mcp_upstream_failures_total")?.reset();
  });

  it("times every call under its upstream, a failed one included", async () => {
    await upstreamCall("tomtom-search", async () => "answer");
    await failWith(new SDKServiceError(UPSTREAM_TEXT, "Search", 503)).catch(() => undefined);

    expect(await metricValues("mcp_upstream_duration_seconds")).toContainEqual(
      expect.objectContaining({
        labels: { upstream: "tomtom-search" },
        metricName: "mcp_upstream_duration_seconds_count",
        value: 2,
      })
    );
  });

  it("returns what the call returns, giving it a signal that has not fired", async () => {
    const result = await upstreamCall("tomtom-search", async (signal) => signal.aborted);

    expect(result).toBe(false);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each(KIND_BY_CODE.filter(([code]) => code !== "INVALID_REQUEST"))(
    "maps %s to its kind, naming the upstream",
    async (code, kind) => {
      const upstream = new SDKError(UPSTREAM_TEXT, "Search", { code });

      const error = await failWith(upstream).catch((caught) => caught);

      expect(error).toBeInstanceOf(kind);
      expect(error.upstream).toBe("tomtom-search");
      expect(error.cause).toBe(upstream);
    }
  );

  it.each(KIND_BY_CODE)("tells the model nothing of the upstream on %s", async (code) => {
    const error = await failWith(new SDKError(UPSTREAM_TEXT, "Search", { code })).catch(
      (caught) => caught
    );

    const payload = toErrorPayload(error);

    expect(Object.keys(payload)).toEqual(["error"]);
    expect(payload.error).not.toMatch(/upstream said|SECRET-KEY|tomtom-search|Search/);
  });

  it("blames TomTom for a request its API answered as invalid", async () => {
    const error = await failWith(new SDKServiceError(UPSTREAM_TEXT, "Search", 400)).catch(
      (caught) => caught
    );

    expect(error).toBeInstanceOf(IncorrectError);
    expect(error.upstream).toBe("tomtom-search");
  });

  it("blames the inputs, not TomTom, when the SDK rejects a request it never sent", async () => {
    const { error: validation } = z.object({ lat: z.number().max(90) }).safeParse({ lat: 151.2 });
    const rejected = new SDKError(validation?.message ?? "", "Search", {
      code: "INVALID_REQUEST",
      issues: validation?.issues,
    });

    const error = await failWith(rejected).catch((caught) => caught);

    expect(error).toBeInstanceOf(IncorrectError);
    expect(error.upstream).toBeUndefined();
    expect(error.cause).toBe(rejected);
    expect(toErrorPayload(error).details).toEqual({
      issues: [{ path: "lat", message: validation?.issues[0].message }],
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("tells the model a missing or unknown key is the server's or the request's to fix", async () => {
    const error = await failWith(new SDKServiceError(UPSTREAM_TEXT, "Search", 401)).catch(
      (caught) => caught
    );

    expect(error.message).toContain("TOMTOM_API_KEY");
    expect(error.message).toContain("tomtom-api-key header");
  });

  it("names every cause of a 403, none of them an invalid key, and where plans are listed", async () => {
    const error = await failWith(new SDKServiceError(UPSTREAM_TEXT, "Search", 403)).catch(
      (caught) => caught
    );

    expect(error.message).toMatch(/free requests/);
    expect(error.message).toMatch(/plan does not include/);
    expect(error.message).toMatch(/not among the key's products/);
    expect(error.message).not.toMatch(/invalid/);
    expect(error.message).toContain("https://docs.tomtom.com/pricing");
  });

  it("keeps the status of a failed API response for the log", async () => {
    const error = await failWith(new SDKServiceError(UPSTREAM_TEXT, "Search", 503)).catch(
      (caught) => caught
    );

    expect(error).toBeInstanceOf(UnavailableError);
    expect(error.data).toEqual({ code: "LIVE_SERVICE_NOT_AVAILABLE", status: 503 });
  });

  it("maps its own deadline firing to an interruption", async () => {
    const error = await failWith(new SDKAbortError("Search")).catch((caught) => caught);

    expect(error).toBeInstanceOf(InterruptedError);
  });

  it("logs and counts one failure naming the upstream, kind and status, without its own text", async () => {
    await failWith(new SDKServiceError(UPSTREAM_TEXT, "Search", 429)).catch(() => undefined);

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [fields, message] = vi.mocked(logger.error).mock.calls[0];
    expect(message).toBe("Upstream call failed");
    expect(fields).toEqual({
      upstream: "tomtom-search",
      errorKind: "BusyError",
      code: "RATE_LIMITED",
      status: 429,
      elapsedMs: expect.any(Number),
    });
    expect(JSON.stringify(fields)).not.toContain("SECRET-KEY");
    expect(await metricValues("mcp_upstream_failures_total")).toEqual([
      { labels: { upstream: "tomtom-search", error_kind: "BusyError" }, value: 1 },
    ]);
  });

  it("passes an error the tool raised inside the call through unchanged and unlogged", async () => {
    const toolError = new IncorrectError("minPowerKW is above maxPowerKW", { minPowerKW: 50 });

    await expect(failWith(toolError)).rejects.toBe(toolError);
    expect(toolError.upstream).toBeUndefined();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("passes an error that is not the SDK's through unchanged", async () => {
    const bug = new TypeError("cannot read properties of undefined");

    await expect(failWith(bug)).rejects.toBe(bug);
  });
});
