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
import { BusyError, ErrorWithData, errorOutcome, IncorrectError } from "./types";

describe("ErrorWithData", () => {
  it("should set name, message, and data properties", () => {
    const err = new ErrorWithData("Invalid coordinate", {
      field: "latitude",
      value: 95.5,
      range: [-90, 90],
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ErrorWithData);
    expect(err.name).toBe("ErrorWithData");
    expect(err.message).toBe("Invalid coordinate");
    expect(err.data).toEqual({
      field: "latitude",
      value: 95.5,
      range: [-90, 90],
    });
  });

  it("should default to empty data object if not provided", () => {
    const err = new ErrorWithData("Something went wrong");
    expect(err.data).toEqual({});
  });

  it("should serialize to JSON", () => {
    const err = new ErrorWithData("API request failed", {
      status_code: 503,
      endpoint: "/search/geocode",
      retry_after: 30,
    });

    const loggedData = JSON.parse(JSON.stringify(err));

    expect(loggedData).toEqual({
      name: "ErrorWithData",
      message: "API request failed",
      data: {
        status_code: 503,
        endpoint: "/search/geocode",
        retry_after: 30,
      },
      stack: expect.any(String),
    });

    expect(loggedData.stack).toContain("ErrorWithData");
  });

  it("names the upstream that failed, apart from its data", () => {
    const error = new BusyError("Busy", { status: 429 }, { upstream: "tomtom-routing" });

    expect(error.upstream).toBe("tomtom-routing");
    expect(error.data).toEqual({ status: 429 });
    expect(JSON.parse(JSON.stringify(error)).upstream).toBe("tomtom-routing");
  });

  it("names no upstream when the tool itself raised it", () => {
    expect(new IncorrectError("Bad input").upstream).toBeUndefined();
  });
});

describe("errorOutcome", () => {
  it("attributes an error with an upstream to that upstream", () => {
    const error = new BusyError("Busy", {}, { upstream: "tomtom-search" });

    expect(errorOutcome(error)).toEqual({
      outcome: "upstream_error",
      errorKind: "BusyError",
      upstream: "tomtom-search",
    });
  });

  it("attributes an error without an upstream to the tool", () => {
    expect(errorOutcome(new IncorrectError("Bad input"))).toEqual({
      outcome: "tool_error",
      errorKind: "IncorrectError",
    });
  });
});
