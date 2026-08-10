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
import { isLegacyBackendSelector } from "./indexHttp";

describe("isLegacyBackendSelector", () => {
  it("recognises the retired backend names, case-insensitively", () => {
    expect(isLegacyBackendSelector("tomtom-orbis-maps")).toBe(true);
    expect(isLegacyBackendSelector("TOMTOM-ORBIS-MAPS")).toBe(true);
    expect(isLegacyBackendSelector("TomTom-Orbis-Maps")).toBe(true);
    expect(isLegacyBackendSelector("tomtom-maps")).toBe(true);
    expect(isLegacyBackendSelector("TOMTOM-MAPS")).toBe(true);
  });

  it("returns false for absent or unrecognised values", () => {
    expect(isLegacyBackendSelector(undefined)).toBe(false);
    expect(isLegacyBackendSelector("")).toBe(false);
    expect(isLegacyBackendSelector("invalid")).toBe(false);
    expect(isLegacyBackendSelector("orbis")).toBe(false);
    expect(isLegacyBackendSelector("genesis")).toBe(false);
  });
});
