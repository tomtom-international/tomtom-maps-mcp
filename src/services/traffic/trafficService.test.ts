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


import { afterEach, describe, expect, it, vi } from "vitest";
import { recordFetch } from "../shared/recordFetch";
import { getTrafficIncidents } from "./trafficService";

const amsterdam: [number, number, number, number] = [4.8, 52.3, 5.0, 52.4];

describe("Traffic Service", () => {
  it("should retrieve traffic incidents from Amsterdam", async () => {
    const result = await getTrafficIncidents(amsterdam);

    expect(result.type).toBe("FeatureCollection");
    const incident = result.features[0];
    if (incident) {
      expect(typeof incident.properties.id).toBe("string");
      expect(typeof incident.properties.category).toBe("string");
      expect(typeof incident.properties.magnitudeOfDelay).toBe("string");
    }
  });

  it("should return only the requested categories", async () => {
    const result = await getTrafficIncidents(amsterdam, {
      categoryFilter: ["road-closed", "roadworks"],
    });

    for (const { properties } of result.features) {
      expect(["road-closed", "roadworks"]).toContain(properties.category);
    }
  });
});

describe("Traffic request parameters", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the bbox, language, category codes and time filter", async () => {
    const requests = recordFetch({ incidents: [] });
    await getTrafficIncidents(amsterdam, {
      language: "nl-NL",
      categoryFilter: ["accident", "road-closed"],
      timeValidityFilter: ["present", "future"],
    });

    const params = requests[0].url.searchParams;
    expect(requests[0].url.pathname).toBe("/maps/orbis/traffic/incidentDetails");
    expect(params.get("bbox")).toBe("4.8,52.3,5,52.4");
    expect(params.get("language")).toBe("nl-NL");
    expect(params.get("categoryFilter")).toBe("1,8");
    expect(params.get("timeValidityFilter")).toBe("present,future");
  });

  it("defaults the language to en-GB", async () => {
    const requests = recordFetch({ incidents: [] });
    await getTrafficIncidents(amsterdam);

    expect(requests[0].url.searchParams.get("language")).toBe("en-GB");
    expect(requests[0].url.searchParams.has("categoryFilter")).toBe(false);
  });
});
