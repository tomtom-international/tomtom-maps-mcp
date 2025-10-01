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
import { getTrafficIncidents } from "./trafficOrbisService";

// Real test using actual API calls
describe("Traffic Service", () => {
  // Use a real bounding box for a busy area (Amsterdam area)
  const amsterdamBBox = "4.8,52.3,5.0,52.4";

  it("should retrieve traffic incidents from Amsterdam", async () => {
    // Call the service with real coordinates
    const result = await getTrafficIncidents(amsterdamBBox);

    // Verify basic response structure
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    expect(result.incidents).toBeDefined();
    expect(Array.isArray(result.incidents)).toBe(true);

    // If there are incidents, verify their structure
    if (result.incidents && result.incidents.length > 0) {
      const incident = result.incidents[0];
      expect(incident.type).toBe("Feature");
      expect(incident.geometry).toBeDefined();
      expect(incident.properties).toBeDefined();

      if (incident.properties) {
        expect(typeof incident.properties.id).toBe("string");
        expect(incident.properties.iconCategory).toBeDefined();
      }
    }
  });

  it("should accept and apply language parameter", async () => {
    const options = {
      language: "nl-NL",
    };

    const result = await getTrafficIncidents(amsterdamBBox, options);

    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    expect(result.incidents).toBeDefined();
    expect(Array.isArray(result.incidents)).toBe(true);
  });
});
