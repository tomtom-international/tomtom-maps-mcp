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

import { describe, it, expect } from "vitest";
import { TomTomApiError, NetworkError, ErrorInfo } from "./types";

describe("TomTomApiError", () => {
  it("should set name, message, statusCode, and response", () => {
    const err = new TomTomApiError(404, "Not found", undefined);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TomTomApiError);
    expect(err.name).toMatch(/TomTomApiError/);
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe("Not found");
  });
});

describe("NetworkError", () => {
  it("should set name and message", () => {
    const err = new NetworkError("No connection");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.name).toMatch(/NetworkError/);
    expect(err.message).toBe("No connection");
  });
});

describe("ErrorInfo", () => {
  it("should set name, message, and data properties", () => {
    const err = new ErrorInfo("Invalid coordinate", {
      field: "latitude",
      value: 95.5,
      range: [-90, 90],
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ErrorInfo);
    expect(err.name).toBe("ErrorInfo");
    expect(err.message).toBe("Invalid coordinate");
    expect(err.data).toEqual({
      field: "latitude",
      value: 95.5,
      range: [-90, 90],
    });
  });

  it("should default to empty data object if not provided", () => {
    const err = new ErrorInfo("Something went wrong");
    expect(err.data).toEqual({});
  });

  it("should serialize to JSON", () => {
    const err = new ErrorInfo("API request failed", {
      status_code: 503,
      endpoint: "/search/geocode",
      retry_after: 30,
    });

    const loggedData = JSON.parse(JSON.stringify(err));

    expect(loggedData).toEqual({
      name: "ErrorInfo",
      message: "API request failed",
      data: {
        status_code: 503,
        endpoint: "/search/geocode",
        retry_after: 30,
      },
      stack: expect.any(String),
    });

    // Verify stack trace is present
    expect(loggedData.stack).toContain("ErrorInfo");
  });
});
