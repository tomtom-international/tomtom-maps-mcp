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

import { handleApiError } from "./apiErrorHandler";
import { AxiosError, AxiosResponse } from "axios";
import { describe, it, expect, vi } from "vitest";
import {
  UnknownError,
  ForbiddenError,
  BusyError,
  UnavailableError,
  IncorrectError,
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
  // Helper function to create mock Axios errors
  function createAxiosError(status: number, data: unknown): AxiosError {
    const response = {
      status,
      data,
      statusText: "Error",
      headers: {},
      config: { headers: { Accept: "application/json, text/plain, */*" } },
    } as AxiosResponse;

    const error = new Error("Request failed") as AxiosError;
    error.isAxiosError = true;
    error.response = response;
    return error;
  }

  it("should handle 401 authentication errors", () => {
    const error = createAxiosError(401, { error: "Unauthorized" });

    const result = handleApiError(error, "test");

    expect(result).toBeInstanceOf(ForbiddenError);
    expect(result.message).toContain("API key may be invalid");
    if (result instanceof ForbiddenError) {
      expect(result.data.domain).toBe("tomtom_api");
      expect(result.data.status_code).toBe(401);
      expect(result.data.context).toBe("test");
    }
  });

  it("should handle 429 rate limit errors", () => {
    const error = createAxiosError(429, { error: "Too Many Requests" });

    const result = handleApiError(error, "test");

    expect(result).toBeInstanceOf(BusyError);
    expect(result.message).toContain("Rate limit exceeded");
    if (result instanceof BusyError) {
      expect(result.data.domain).toBe("tomtom_api");
      expect(result.data.status_code).toBe(429);
      expect(result.data.context).toBe("test");
    }
  });

  it("should handle 503 service unavailable errors", () => {
    const error = createAxiosError(503, { error: "Service Unavailable" });

    const result = handleApiError(error, "test");

    expect(result).toBeInstanceOf(UnavailableError);
    expect(result.message).toContain("service unavailable");
    if (result instanceof UnavailableError) {
      expect(result.data.domain).toBe("tomtom_api");
      expect(result.data.status_code).toBe(503);
      expect(result.data.context).toBe("test");
    }
  });

  it('should handle 503 with "no healthy upstream" message', () => {
    const error = createAxiosError(503, { error: "no healthy upstream" });

    const result = handleApiError(error, "test");

    expect(result).toBeInstanceOf(UnavailableError);
    expect(result.message).toContain("TomTom service temporarily unavailable");
    if (result instanceof UnavailableError) {
      expect(result.data.domain).toBe("tomtom_api");
      expect(result.data.status_code).toBe(503);
      expect(result.data.context).toBe("test");
    }
  });

  it("should handle TomTom detailed error format", () => {
    const error = createAxiosError(400, {
      detailedError: {
        code: "INVALID_PARAMETERS",
        message: "Invalid parameters provided",
      },
    });

    const result = handleApiError(error, "test");

    expect(result).toBeInstanceOf(IncorrectError);
    expect(result.message).toContain("Bad request");
    if (result instanceof IncorrectError) {
      expect(result.data.domain).toBe("tomtom_api");
      expect(result.data.status_code).toBe(400);
      expect(result.data.context).toBe("test");
      expect(result.data.error_details).toContain("INVALID_PARAMETERS");
      expect(result.data.error_details).toContain("Invalid parameters provided");
    }
  });

  it("should handle non-Axios errors", () => {
    const error = new Error("Regular error");

    const result = handleApiError(error, "test");

    expect(result.message).toBe("Unknown error");
    expect(result).toBeInstanceOf(UnknownError);
    if (result instanceof UnknownError) {
      expect(result.cause).toBe(error);
      expect(result.data.context).toBe("test");
    }
  });
});
