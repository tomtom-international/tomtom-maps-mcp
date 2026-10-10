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
import { getRoute } from "./routingService";

import { recordFetch, type RecordedRequest } from "../shared/recordFetch";

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

  it.each([
    ["alone", {}],
    ["with the vehicle", { vehicleMaxSpeed: 90, vehicleWeight: 2000 }],
  ])("sends a heading of 0 (north) %s", async (_name, vehicle) => {
    const body = await lastBody(() =>
      getRoute([amsterdam, utrecht], { ...vehicle, vehicleHeading: 0 })
    );

    expect(body).toMatchObject({ vehicleHeadingInDegrees: 0 });
  });

  it("rejects more than five alternatives before calling the API", async () => {
    await expect(getRoute([amsterdam, utrecht], { maxAlternatives: 7 })).rejects.toThrow(
      "maxAlternatives must be a whole number from 0 to 5"
    );
    expect(requests).toHaveLength(0);
  });

  it("sends the vehicle max speed and weight", async () => {
    const body = await lastBody(() =>
      getRoute([amsterdam, utrecht], { vehicleMaxSpeed: 90, vehicleWeight: 2000 })
    );

    expect(body).toMatchObject({
      vehicleWeightInKilograms: 2000,
      vehicleMaxSpeedInKilometersPerHour: 90,
    });
  });
});
