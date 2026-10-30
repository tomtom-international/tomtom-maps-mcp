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

import type { Polygon } from "geojson";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RecordedRequest, recordFetch } from "../shared/recordFetch";
import { getTrafficIncidents } from "./trafficService";

vi.mock("../api-key", () => ({ requireApiKey: () => "offline-test-key" }));

// Offline: stub fetch and inspect the request the SDK builds, as the search
// request tests do.
describe("Traffic SDK Service request parameters", () => {
  let requests: RecordedRequest[];

  beforeEach(() => {
    requests = recordFetch({ incidents: [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function lastRecorded(call: () => Promise<unknown>): Promise<RecordedRequest> {
    await call().catch(() => undefined);
    expect(requests.length).toBeGreaterThan(0);
    return requests[requests.length - 1];
  }

  it("sends a bounding box as given, with the language and filters", async () => {
    const { url, headers } = await lastRecorded(() =>
      getTrafficIncidents([4.8, 52.3, 5.0, 52.45], {
        language: "nl-NL",
        categoryFilter: ["jam"],
        timeValidityFilter: ["present"],
      })
    );

    expect(url.pathname).toContain("/traffic/incidents/details");
    expect(url.searchParams.get("bbox")).toBe("4.8,52.3,5,52.45");
    expect(url.searchParams.get("iconCategories")).toBe("jam");
    expect(url.searchParams.get("timeValidity")).toBe("present");
    expect(headers.get("Accept-Language")).toBe("nl-NL");
  });

  it("sends a polygon as its bounding box", async () => {
    const triangle: Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [4.8, 52.3],
          [5.0, 52.3],
          [5.0, 52.45],
          [4.8, 52.3],
        ],
      ],
    };
    const { url } = await lastRecorded(() => getTrafficIncidents(triangle));

    expect(url.searchParams.get("bbox")).toBe("4.8,52.3,5,52.45");
  });

  it("defaults the language to British English", async () => {
    const { headers } = await lastRecorded(() => getTrafficIncidents([4.8, 52.3, 5.0, 52.45]));

    expect(headers.get("Accept-Language")).toBe("en-GB");
  });
});
