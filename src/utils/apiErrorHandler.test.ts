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
import { metricsRegistry } from "../metrics/metrics";
import { metricValues } from "../metrics/metricValues";
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
  fromUrlTransportFailure,
  handleApiError,
  REQUEST_FAILED_MESSAGE,
  toErrorPayload,
} from "./apiErrorHandler";

import { logger } from "./logger";

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
    const error = new BusyError("The TomTom service is busy", {}, { upstream: "tomtom-search" });

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
    expect(result.upstream).toBe("data-url");
  });
});

describe("a failed data_url request", () => {
  beforeEach(() => metricsRegistry.getSingleMetric("mcp_upstream_failures_total")?.reset());

  it("logs and counts one upstream failure with the status it answered", async () => {
    fromUrlStatus(404, new Error("Request failed with status code 404"));

    expect(logger.error).toHaveBeenCalledWith(
      { upstream: "data-url", errorKind: "IncorrectError", status: 404 },
      "Upstream call failed"
    );
    expect(await metricValues("mcp_upstream_failures_total")).toEqual([
      { labels: { upstream: "data-url", error_kind: "IncorrectError" }, value: 1 },
    ]);
  });

  it("logs and counts one upstream failure with the code of a request that got no answer", async () => {
    fromUrlTransportFailure("ETIMEDOUT", new Error("timeout of 10000ms exceeded"));

    expect(logger.error).toHaveBeenCalledWith(
      { upstream: "data-url", errorKind: "InterruptedError", code: "ETIMEDOUT" },
      "Upstream call failed"
    );
    expect(await metricValues("mcp_upstream_failures_total")).toEqual([
      { labels: { upstream: "data-url", error_kind: "InterruptedError" }, value: 1 },
    ]);
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
