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

import { fromUrlStatus, handleApiError, toErrorPayload } from "./apiErrorHandler";
import { SDKServiceError } from "@tomtom-org/maps-sdk/services";
import { describe, it, expect, vi } from "vitest";
import {
  UnknownError,
  ForbiddenError,
  BusyError,
  UnavailableError,
  IncorrectError,
  FaultError,
} from "../types/types";

// Mock the logger to prevent console output during tests
vi.mock("./logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("Error Handler", () => {
  function sdkError(status: number, message: string): SDKServiceError {
    return new SDKServiceError(message, "TrafficIncidentDetails", status);
  }

  it("should handle 401 authentication errors", () => {
    const result = handleApiError(
      sdkError(401, "You are missing valid authentication credentials"),
      "test"
    );

    expect(result).toBeInstanceOf(ForbiddenError);
    expect(result.message).toContain("rejected the API key as missing or invalid");
    expect(result.message).toContain("tomtom-api-key header");
    if (result instanceof ForbiddenError) {
      expect(result.data.domain).toBe("tomtom_api");
      expect(result.data.status_code).toBe(401);
      expect(result.data.context).toBe("test");
    }
  });

  it("should name the account, not the key, for a 403", () => {
    const result = handleApiError(
      sdkError(403, "You are not allowed to access this endpoint"),
      "test"
    );

    expect(result).toBeInstanceOf(ForbiddenError);
    expect(result.message).toContain("used up its free requests");
    expect(result.message).toContain("plan does not include this API");
    expect(result.message).toContain("https://docs.tomtom.com/pricing");
    expect(result.message).not.toContain("invalid");
    if (result instanceof ForbiddenError) {
      expect(result.data.status_code).toBe(403);
    }
  });

  it("should handle 429 rate limit errors", () => {
    const result = handleApiError(sdkError(429, "Too Many Requests"), "test");

    expect(result).toBeInstanceOf(BusyError);
    expect(result.message).toContain("Rate limit exceeded");
    if (result instanceof BusyError) {
      expect(result.data.status_code).toBe(429);
    }
  });

  it("should handle 503 service unavailable errors", () => {
    const result = handleApiError(sdkError(503, "Service Unavailable"), "test");

    expect(result).toBeInstanceOf(UnavailableError);
    expect(result.message).toContain("service unavailable");
    if (result instanceof UnavailableError) {
      expect(result.data.status_code).toBe(503);
    }
  });

  it('should handle 503 with "no healthy upstream" message', () => {
    const result = handleApiError(sdkError(503, "no healthy upstream"), "test");

    expect(result).toBeInstanceOf(UnavailableError);
    expect(result.message).toContain("TomTom service temporarily unavailable");
  });

  it("should handle 500 server errors", () => {
    const result = handleApiError(sdkError(500, "Internal error"), "test");

    expect(result).toBeInstanceOf(FaultError);
  });

  it("should keep the API's message for a bad request", () => {
    const result = handleApiError(
      sdkError(400, "Invalid request: energy budget may not be greater than current charge."),
      "test"
    );

    expect(result).toBeInstanceOf(IncorrectError);
    expect(result.message).toContain("Bad request");
    if (result instanceof IncorrectError) {
      expect(result.data.error_details).toContain("energy budget");
    }
  });

  it("should handle other errors", () => {
    const error = new Error("Regular error");

    const result = handleApiError(error, "test");

    expect(result.message).toBe("Regular error");
    expect(result).toBeInstanceOf(UnknownError);
    if (result instanceof UnknownError) {
      expect(result.cause).toBe(error);
      expect(result.data.context).toBe("test");
    }
  });
});

describe("fromUrlStatus", () => {
  it.each([
    [301, IncorrectError],
    [401, ForbiddenError],
    [403, ForbiddenError],
    [404, IncorrectError],
    [429, BusyError],
    [500, FaultError],
    [502, FaultError],
    [503, UnavailableError],
  ])("maps %i to %O, naming neither TomTom nor the API key", (status, errorClass) => {
    const cause = new Error(`Request failed with status code ${status}`);

    const result = fromUrlStatus(status, cause);

    expect(result).toBeInstanceOf(errorClass);
    expect(result.message).not.toMatch(/TomTom|API key/);
    expect(result.cause).toBe(cause);
    expect(result.data).toEqual({ status });
  });
});

describe("toErrorPayload", () => {
  it("adds the offending values for a caller error", () => {
    const error = new IncorrectError("Unknown avoid values", { unknown_avoid: ["highways"] });
    expect(toErrorPayload(error)).toEqual({
      error: "Unknown avoid values",
      details: { unknown_avoid: ["highways"] },
    });
  });

  it("returns only the message for other errors", () => {
    const error = new UnavailableError("TomTom API is unavailable", { status_code: 503 });
    expect(toErrorPayload(error)).toEqual({ error: "TomTom API is unavailable" });
  });
});
