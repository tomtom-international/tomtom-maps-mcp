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

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BusyError,
  type ErrorKind,
  FaultError,
  ForbiddenError,
  IncorrectError,
  UnavailableError,
  UnknownError,
} from "../types/types";
import { logger } from "../utils/logger";
import { fromUlsResponse } from "./ulsErrors";

vi.mock("../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe("fromUlsResponse", () => {
  beforeEach(() => vi.mocked(logger.error).mockClear());

  it.each<[string, number, ErrorKind]>([
    ["access_denied", 403, ForbiddenError],
    ["invalid_grant", 400, ForbiddenError],
    ["unauthorized_client", 400, FaultError],
    ["invalid_scope", 400, IncorrectError],
    ["invalid_request", 400, IncorrectError],
    ["unsupported_grant_type", 400, IncorrectError],
    ["temporarily_unavailable", 503, UnavailableError],
    ["server_error", 500, FaultError],
  ])("maps ULS's %s to its kind", (error, status, kind) => {
    const failure = fromUlsResponse("uls-api-key", status, { error });

    expect(failure).toBeInstanceOf(kind);
    expect(failure).toMatchObject({ upstream: "uls-api-key", data: { status, error } });
  });

  it.each<[number, ErrorKind]>([
    [429, BusyError],
    [503, UnavailableError],
    [502, FaultError],
    [401, ForbiddenError],
    [403, ForbiddenError],
    [418, UnknownError],
  ])("falls back on the status %i when the body names no ULS error", (status, kind) => {
    expect(fromUlsResponse("uls-token-exchange", status, null)).toBeInstanceOf(kind);
    expect(
      fromUlsResponse("uls-token-exchange", status, { error: "not_a_uls_code" })
    ).toBeInstanceOf(kind);
  });

  it("logs the failure once with its upstream, kind and ULS's own reason", () => {
    fromUlsResponse(
      "uls-api-key",
      403,
      { error: "access_denied", error_description: "no write permission on project" },
      { requestId: "req-7" }
    );

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      {
        requestId: "req-7",
        upstream: "uls-api-key",
        errorKind: "ForbiddenError",
        status: 403,
        error: "access_denied",
        errorDescription: "no write permission on project",
      },
      "ULS token exchange failed"
    );
  });
});
