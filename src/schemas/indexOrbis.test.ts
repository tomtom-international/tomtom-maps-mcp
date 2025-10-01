/*
 * Copyright (C) 2025 TomTom NV
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
import { schemas } from "./indexOrbis";

describe("schemas index", () => {
  it("should export all expected schemas", () => {
    expect(Object.keys(schemas).sort()).toEqual(
      [
        "tomtomFuzzySearchSchema",
        "tomtomPOISearchSchema",
        "tomtomNearbySearchSchema",
        "tomtomGeocodeSearchSchema",
        "tomtomReverseGeocodeSearchSchema",
        "tomtomRoutingSchema",
        "tomtomWaypointRoutingSchema",
        "tomtomReachableRangeSchema",
        "tomtomMapSchema",
        "tomtomDynamicMapSchema",
        "tomtomTrafficSchema",
      ].sort()
    );
  });

  it("should have all schemas as objects or schema definitions", () => {
    for (const key of Object.keys(schemas)) {
      expect(typeof (schemas as any)[key]).toBe("object");
    }
  });
});
