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
import { TomTomApiError, NetworkError } from "./types";

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
