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
import { redactCredentials } from "./redact";

describe("redactCredentials", () => {
  it("removes the key the SDK echoes into reachable-range feature properties", () => {
    // The real shape, measured: every isochrone feature carried the live key.
    const response = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [] },
          properties: {
            apiKey: "0123456789abcdef0123456789abcdef",
            commonBaseURL: "https://api.tomtom.com",
            budget: { type: "time", value: 600 },
          },
        },
      ],
    };

    redactCredentials(response);

    expect(response.features[0].properties).not.toHaveProperty("apiKey");
    // Non-credential config is left alone — it is noise, not a secret.
    expect(response.features[0].properties.budget).toEqual({ type: "time", value: 600 });
  });

  it("matches regardless of case and nesting", () => {
    const value = { a: { b: [{ ApiKey: "x", Authorization: "y", keep: 1 }] } };
    redactCredentials(value);
    expect(value.a.b[0]).toEqual({ keep: 1 });
  });

  it("leaves legitimate map data that merely resembles a credential name", () => {
    // A redactor that eats real results is worse than the leak it prevents.
    const value = { properties: { poi: { name: "Turnkey Bakery" }, keyword: "bread" } };
    redactCredentials(value);
    expect(value.properties.poi.name).toBe("Turnkey Bakery");
    expect(value.properties.keyword).toBe("bread");
  });

  it("survives values it cannot walk", () => {
    expect(redactCredentials(null)).toBeNull();
    expect(redactCredentials("plain")).toBe("plain");
  });
});
