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
import { tomtomCall } from "./tomtomCall";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const UPSTREAM_TEXT = "upstream said https://api.tomtom.com/search?key=SECRET-KEY";

const failWith = (error: unknown) => tomtomCall("tomtom-search", () => Promise.reject(error));

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

describe("tomtomCall", () => {
  beforeEach(() => vi.mocked(logger.error).mockClear());

  it("returns what the call returns, giving it a signal that has not fired", async () => {
    const result = await tomtomCall("tomtom-search", async (signal) => signal.aborted);

    expect(result).toBe(false);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each(KIND_BY_CODE)("maps %s to its kind, naming the dependency", async (code, kind) => {
    const upstream = new SDKError(UPSTREAM_TEXT, "Search", { code });

    const error = await failWith(upstream).catch((caught) => caught);

    expect(error).toBeInstanceOf(kind);
    expect(error.dependency).toBe("tomtom-search");
    expect(error.cause).toBe(upstream);
  });

  it.each(KIND_BY_CODE)("tells the model nothing of the upstream on %s", async (code) => {
    const error = await failWith(new SDKError(UPSTREAM_TEXT, "Search", { code })).catch(
      (caught) => caught
    );

    const payload = toErrorPayload(error);

    expect(Object.keys(payload)).toEqual(["error"]);
    expect(payload.error).not.toMatch(/upstream said|SECRET-KEY|tomtom-search|Search/);
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

  it("logs one line naming the dependency, kind and status, without the upstream text", async () => {
    await failWith(new SDKServiceError(UPSTREAM_TEXT, "Search", 429)).catch(() => undefined);

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [fields, message] = vi.mocked(logger.error).mock.calls[0];
    expect(message).toBe("Upstream call failed");
    expect(fields).toEqual({
      dependency: "tomtom-search",
      errorKind: "BusyError",
      code: "RATE_LIMITED",
      status: 429,
      elapsedMs: expect.any(Number),
    });
    expect(JSON.stringify(fields)).not.toContain("SECRET-KEY");
  });

  it("passes an error the tool raised inside the call through unchanged and unlogged", async () => {
    const toolError = new IncorrectError("minPowerKW is above maxPowerKW", { minPowerKW: 50 });

    await expect(failWith(toolError)).rejects.toBe(toolError);
    expect(toolError.dependency).toBeUndefined();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("passes an error that is not the SDK's through unchanged", async () => {
    const bug = new TypeError("cannot read properties of undefined");

    await expect(failWith(bug)).rejects.toBe(bug);
  });
});
