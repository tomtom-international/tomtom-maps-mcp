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
import { getReachableRange, getRoute } from "./routingService";
import type { ReachableRangeOptions } from "./types";

import { recordFetch, type RecordedRequest } from "../shared/recordFetch";

vi.mock("../base/tomtomClient", () => ({ requireApiKey: () => "offline-test-key" }));

// Offline: stub fetch and inspect the requests the SDK builds.
describe("Reachable range request parameters", () => {
  const origin = [4.89707, 52.377956];
  let requests: RecordedRequest[];

  beforeEach(() => {
    requests = recordFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Reachable range API version 3: the vehicle, cost model and time go in the JSON body.
  async function requestBody(options: ReachableRangeOptions): Promise<Record<string, unknown>> {
    await getReachableRange(origin, options).catch(() => undefined);
    expect(requests).toHaveLength(1);
    return JSON.parse(requests[0].body);
  }

  it("sends vehicle max speed and weight", async () => {
    const body = await requestBody({
      timeBudgetInSec: 1800,
      vehicleMaxSpeed: 90,
      vehicleWeight: 3500,
    });

    expect(body).toMatchObject({
      vehicleMaxSpeedInKilometersPerHour: 90,
      vehicleWeightInKilograms: 3500,
    });
  });

  it.each([
    ["two budgets", { timeBudgetInSec: 1800, distanceBudgetInMeters: 5000 }, "Give one budget"],
    ["no budget", {}, "At least one budget parameter"],
  ])("rejects %s before calling the API", async (_name, options, message) => {
    await expect(getReachableRange(origin, options)).rejects.toThrow(message);
    expect(requests).toHaveLength(0);
  });

  it("sends the cost model and departure time", async () => {
    const body = await requestBody({
      timeBudgetInSec: 1800,
      routeType: "short",
      traffic: "historical",
      avoid: ["tollRoads", "ferries"],
      departAt: "2026-10-01T08:00:00Z",
    });

    expect(body).toMatchObject({
      routeType: "short",
      traffic: "historical",
      avoids: ["tollRoads", "ferries"],
      departureDateTime: "2026-10-01T08:00:00.000Z",
    });
  });
});

// Route calculations are POSTs: inspect the JSON body the SDK builds.
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
