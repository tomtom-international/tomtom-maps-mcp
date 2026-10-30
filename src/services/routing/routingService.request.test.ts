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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RecordedRequest, recordFetch } from "../shared/recordFetch";
import { getRoute } from "./routingService";

vi.mock("../api-key", () => ({ requireApiKey: () => "offline-test-key" }));

// Offline: stub fetch and inspect the JSON body the SDK builds for a route, which is a POST.
describe("Route request bodies", () => {
  const amsterdam = [4.89707, 52.377956];
  const utrecht = [5.10962, 52.09083];
  let requests: RecordedRequest[];

  beforeEach(() => {
    requests = recordFetch({ routes: [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function lastBody(call: () => Promise<unknown>): Promise<Record<string, unknown>> {
    await call().catch(() => undefined);
    expect(requests.length).toBeGreaterThan(0);
    return JSON.parse(requests[requests.length - 1].body || "{}");
  }

  it("sends the route cost model, departure time and alternatives", async () => {
    const body = await lastBody(() =>
      getRoute([amsterdam, utrecht], {
        routeType: "short",
        traffic: "historical",
        avoid: ["tollRoads"],
        departAt: "2026-10-01T08:00:00Z",
        maxAlternatives: 2,
      })
    );

    expect(body).toMatchObject({
      routeType: "short",
      traffic: "historical",
      avoids: ["tollRoads"],
      departureDateTime: "2026-10-01T08:00:00.000Z",
      maxPathAlternativeRoutes: 2,
    });
  });

  it("asks for the usual and free-flow travel times, and guidance only when wanted", async () => {
    const guided = await lastBody(() => getRoute([amsterdam, utrecht], {}, { guidance: true }));
    expect(requests.at(-1)?.url.searchParams.get("computeTravelTimeFor")).toBe("all");
    expect(guided.guidance).toBe("instructions");

    const plain = await lastBody(() => getRoute([amsterdam, utrecht]));
    expect(plain).not.toHaveProperty("guidance");
  });

  it("sends a time with no offset unconverted, for the API to read at the origin", async () => {
    const body = await lastBody(() =>
      getRoute([amsterdam, utrecht], { departAt: "2026-10-01T08:15:00.000" })
    );

    expect(body.departureDateTime).toBe("2026-10-01T08:15:00");
  });

  it("rejects more than five alternatives before calling the API", async () => {
    await expect(getRoute([amsterdam, utrecht], { maxAlternatives: 7 })).rejects.toThrow(
      "maxAlternatives must be a whole number from 0 to 5"
    );
    expect(requests).toHaveLength(0);
  });
});
