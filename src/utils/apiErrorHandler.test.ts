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

import { describe, expect, it, vi } from "vitest";
import {
  BusyError,
  FaultError,
  ForbiddenError,
  IncorrectError,
  UnavailableError,
  UnknownError,
} from "../types/types";
import {
  fromUrlStatus,
  handleApiError,
  REQUEST_FAILED_MESSAGE,
  toErrorPayload,
} from "./apiErrorHandler";

// Mock the logger to prevent console output during tests
vi.mock("./logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("handleApiError", () => {
  it("passes an error of the hierarchy through unchanged", () => {
    const error = new BusyError("The TomTom service is busy", {}, { dependency: "tomtom-search" });

    expect(handleApiError(error)).toBe(error);
  });

  it.each([new Error("reading 'lat' of undefined"), "a thrown string"])(
    "answers anything else generically, keeping it as the cause: %s",
    (thrown) => {
      const result = handleApiError(thrown);

      expect(result).toBeInstanceOf(UnknownError);
      expect(result.message).toBe(REQUEST_FAILED_MESSAGE);
      expect(result.data).toEqual({});
      expect(result.cause).toBe(thrown);
    }
  );
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
