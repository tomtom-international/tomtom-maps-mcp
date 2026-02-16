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
  it("returns 'tomtom-orbis-maps' when MAPS=tomtom-orbis-maps", () => {
    expect(resolveFixedBackend("tomtom-orbis-maps")).toBe("tomtom-orbis-maps");
    expect(resolveFixedBackend("TOMTOM-ORBIS-MAPS")).toBe("tomtom-orbis-maps");
    expect(resolveFixedBackend("TomTom-Orbis-Maps")).toBe("tomtom-orbis-maps");
  });

  it("returns 'tomtom-maps' when MAPS=tomtom-maps", () => {
    expect(resolveFixedBackend("tomtom-maps")).toBe("tomtom-maps");
    expect(resolveFixedBackend("TOMTOM-MAPS")).toBe("tomtom-maps");
    expect(resolveFixedBackend("TomTom-Maps")).toBe("tomtom-maps");
  });

  it("returns null for undefined/empty/invalid values (dual mode)", () => {
    expect(resolveFixedBackend(undefined)).toBeNull();
    expect(resolveFixedBackend("")).toBeNull();
    expect(resolveFixedBackend("invalid")).toBeNull();
    expect(resolveFixedBackend("both")).toBeNull();
    expect(resolveFixedBackend("orbis")).toBeNull();
    expect(resolveFixedBackend("genesis")).toBeNull();
  });
});

describe("resolveBackendFromHeader", () => {
  describe("fixed backend mode (env var set)", () => {
    it("always returns fixed backend regardless of header", () => {
      expect(resolveBackendFromHeader("tomtom-orbis-maps", "tomtom-maps")).toBe(
        "tomtom-orbis-maps"
      );
      expect(resolveBackendFromHeader("tomtom-orbis-maps", undefined)).toBe("tomtom-orbis-maps");
      expect(resolveBackendFromHeader("tomtom-maps", "tomtom-orbis-maps")).toBe("tomtom-maps");
      expect(resolveBackendFromHeader("tomtom-maps", undefined)).toBe("tomtom-maps");
    });
  });

  describe("dual backend mode (env var not set)", () => {
    it("returns 'tomtom-orbis-maps' when header is 'tomtom-orbis-maps'", () => {
      expect(resolveBackendFromHeader(null, "tomtom-orbis-maps")).toBe("tomtom-orbis-maps");
      expect(resolveBackendFromHeader(null, "TOMTOM-ORBIS-MAPS")).toBe("tomtom-orbis-maps");
      expect(resolveBackendFromHeader(null, "TomTom-Orbis-Maps")).toBe("tomtom-orbis-maps");
    });

    it("returns 'tomtom-maps' when header is 'tomtom-maps'", () => {
      expect(resolveBackendFromHeader(null, "tomtom-maps")).toBe("tomtom-maps");
      expect(resolveBackendFromHeader(null, "TOMTOM-MAPS")).toBe("tomtom-maps");
    });

    it("returns default backend when header is missing or invalid", () => {
      expect(resolveBackendFromHeader(null, undefined)).toBe("tomtom-maps");
      expect(resolveBackendFromHeader(null, "")).toBe("tomtom-maps");
      expect(resolveBackendFromHeader(null, "invalid")).toBe("tomtom-maps");
    });

    it("respects custom default backend", () => {
      expect(resolveBackendFromHeader(null, undefined, "tomtom-orbis-maps")).toBe(
        "tomtom-orbis-maps"
      );
      expect(resolveBackendFromHeader(null, "invalid", "tomtom-orbis-maps")).toBe(
        "tomtom-orbis-maps"
      );
    });
  });
});
