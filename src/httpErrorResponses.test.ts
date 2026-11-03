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

import { describe, expect, it } from "vitest";
import { httpErrorResponse } from "./httpErrorResponses";
import {
  BusyError,
  ConflictError,
  ErrorWithData,
  type ErrorKind,
  FaultError,
  ForbiddenError,
  IncorrectError,
  InterruptedError,
  NotFoundError,
  UnavailableError,
  UnknownError,
  UnsupportedError,
} from "./types/types";

describe("httpErrorResponse", () => {
  it.each<[ErrorKind, number]>([
    [ForbiddenError, 403],
    [UnavailableError, 503],
    [InterruptedError, 504],
    [BusyError, 429],
    [FaultError, 502],
    [IncorrectError, 400],
    [NotFoundError, 500],
    [ConflictError, 500],
    [UnsupportedError, 500],
    [UnknownError, 500],
    [ErrorWithData, 500],
  ])("answers %O with %i and one generic message", (kind, status) => {
    const error = new kind(
      "ULS said: invalid subject_token for https://uls.example/token",
      { status: 400, error: "invalid_grant" },
      { upstream: "uls-api-key" }
    );

    const response = httpErrorResponse(error);

    expect(response.status).toBe(status);
    expect(response.message).not.toMatch(/ULS said|uls\.example|invalid_grant|uls-api-key/);
  });

  it("tells a client when to retry an unavailable upstream", () => {
    expect(httpErrorResponse(new UnavailableError("down")).retryAfterSeconds).toBe(30);
    expect(httpErrorResponse(new FaultError("broken")).retryAfterSeconds).toBeUndefined();
  });
});
