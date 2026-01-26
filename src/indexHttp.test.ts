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
import { resolveFixedBackend, resolveBackendFromHeader } from "./indexHttp";

describe("resolveFixedBackend", () => {
  it("returns 'orbis' when MAPS=orbis", () => {
    expect(resolveFixedBackend("orbis")).toBe("orbis");
    expect(resolveFixedBackend("ORBIS")).toBe("orbis");
    expect(resolveFixedBackend("Orbis")).toBe("orbis");
  });

  it("returns 'genesis' when MAPS=genesis", () => {
    expect(resolveFixedBackend("genesis")).toBe("genesis");
    expect(resolveFixedBackend("GENESIS")).toBe("genesis");
    expect(resolveFixedBackend("Genesis")).toBe("genesis");
  });

  it("returns null for undefined/empty/invalid values (dual mode)", () => {
    expect(resolveFixedBackend(undefined)).toBeNull();
    expect(resolveFixedBackend("")).toBeNull();
    expect(resolveFixedBackend("invalid")).toBeNull();
    expect(resolveFixedBackend("both")).toBeNull();
  });
});

describe("resolveBackendFromHeader", () => {
  describe("fixed backend mode (env var set)", () => {
    it("always returns fixed backend regardless of header", () => {
      expect(resolveBackendFromHeader("orbis", "genesis")).toBe("orbis");
      expect(resolveBackendFromHeader("orbis", undefined)).toBe("orbis");
      expect(resolveBackendFromHeader("genesis", "orbis")).toBe("genesis");
      expect(resolveBackendFromHeader("genesis", undefined)).toBe("genesis");
    });
  });

  describe("dual backend mode (env var not set)", () => {
    it("returns 'orbis' when header is 'orbis'", () => {
      expect(resolveBackendFromHeader(null, "orbis")).toBe("orbis");
      expect(resolveBackendFromHeader(null, "ORBIS")).toBe("orbis");
      expect(resolveBackendFromHeader(null, "Orbis")).toBe("orbis");
    });

    it("returns 'genesis' when header is 'genesis'", () => {
      expect(resolveBackendFromHeader(null, "genesis")).toBe("genesis");
      expect(resolveBackendFromHeader(null, "GENESIS")).toBe("genesis");
    });

    it("returns default backend when header is missing or invalid", () => {
      expect(resolveBackendFromHeader(null, undefined)).toBe("genesis");
      expect(resolveBackendFromHeader(null, "")).toBe("genesis");
      expect(resolveBackendFromHeader(null, "invalid")).toBe("genesis");
    });

    it("respects custom default backend", () => {
      expect(resolveBackendFromHeader(null, undefined, "orbis")).toBe("orbis");
      expect(resolveBackendFromHeader(null, "invalid", "orbis")).toBe("orbis");
    });
  });
});
