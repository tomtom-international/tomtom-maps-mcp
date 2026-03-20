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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readVersion } from "./readVersion";

describe("readVersion", () => {
  const originalEnv = process.env.VERSION;

  beforeEach(() => {
    // Clean up VERSION env var before each test
    delete process.env.VERSION;
  });

  afterEach(() => {
    // Restore original VERSION env var after each test
    if (originalEnv !== undefined) {
      process.env.VERSION = originalEnv;
    } else {
      delete process.env.VERSION;
    }
  });

  it("should return version from version.ts when VERSION env var is not set", () => {
    const version = readVersion();
    expect(version).toBeDefined();
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
  });

  it("should return version from VERSION env var when set", () => {
    process.env.VERSION = "test-version-1.2.3";
    const version = readVersion();
    expect(version).toBe("test-version-1.2.3");
  });

  it("should prioritize VERSION env var over version.ts", () => {
    process.env.VERSION = "env-version";
    const version = readVersion();
    expect(version).toBe("env-version");
  });

  it("should handle empty VERSION env var by falling back to version.ts", () => {
    process.env.VERSION = "";
    const version = readVersion();
    // Empty string is falsy, so should fall back to VERSION from version.ts
    expect(version).toBeDefined();
    expect(version).not.toBe("");
  });
});
