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
import { calculateEVRoute, getReachableRange, getRoute } from "./routingService";
import type { ReachableRangeOptions } from "./types";

import { recordFetch, type RecordedRequest } from "../shared/recordFetch";

vi.mock("../base/tomtomClient", () => ({ requireApiKey: () => "offline-test-key" }));

// Offline: stub fetch and inspect the URLs the SDK builds, so these tests check that
// vehicle options reach the TomTom API rather than being dropped by the SDK's request builder.
describe("Reachable range request parameters", () => {
  const origin = [4.89707, 52.377956];
  let requests: RecordedRequest[];

  beforeEach(() => {
    requests = recordFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Reachable range API version 3: efficiencies and consumption go in the query,
  // the vehicle, cost model and time in the JSON body.
  async function request(
    options: ReachableRangeOptions
  ): Promise<{ query: URLSearchParams; body: Record<string, unknown> }> {
    await getReachableRange(origin, options).catch(() => undefined);
    expect(requests).toHaveLength(1);
    return { query: requests[0].url.searchParams, body: JSON.parse(requests[0].body) };
  }

  it("sends vehicle max speed and weight without an engine type", async () => {
    const { body } = await request({
      timeBudgetInSec: 1800,
      vehicleMaxSpeed: 90,
      vehicleWeight: 3500,
    });

    expect(body).toMatchObject({
      vehicleMaxSpeedInKilometersPerHour: 90,
      vehicleWeightInKilograms: 3500,
    });
  });

  it("sends combustion efficiency, max speed and weight", async () => {
    const { query, body } = await request({
      timeBudgetInSec: 1800,
      vehicleEngineType: "combustion",
      constantSpeedConsumptionInLitersPerHundredkm: "50,6.3:130,11.5",
      accelerationEfficiency: 0.33,
      decelerationEfficiency: 0.83,
      uphillEfficiency: 0.27,
      downhillEfficiency: 0.51,
      vehicleMaxSpeed: 110,
      vehicleWeight: 1600,
    });

    expect(query.get("accelerationEfficiency")).toBe("0.33");
    expect(query.get("decelerationEfficiency")).toBe("0.83");
    expect(query.get("uphillEfficiency")).toBe("0.27");
    expect(query.get("downhillEfficiency")).toBe("0.51");
    expect(body).toMatchObject({
      vehicleMaxSpeedInKilometersPerHour: 110,
      vehicleWeightInKilograms: 1600,
    });
  });

  it("sends electric efficiency and weight", async () => {
    const { query, body } = await request({
      timeBudgetInSec: 1800,
      vehicleEngineType: "electric",
      constantSpeedConsumptionInkWhPerHundredkm: "50,8.2:130,21.3",
      maxChargeInkWh: 60,
      currentChargeInkWh: 30,
      accelerationEfficiency: 0.66,
      decelerationEfficiency: 0.91,
      uphillEfficiency: 0.74,
      downhillEfficiency: 0.73,
      vehicleWeight: 1900,
    });

    expect(query.get("accelerationEfficiency")).toBe("0.66");
    expect(query.get("decelerationEfficiency")).toBe("0.91");
    expect(query.get("uphillEfficiency")).toBe("0.74");
    expect(query.get("downhillEfficiency")).toBe("0.73");
    expect(body).toMatchObject({ vehicleEngineType: "electric", vehicleWeightInKilograms: 1900 });
  });

  it("rejects efficiency parameters without a vehicle weight before calling the API", async () => {
    await expect(
      getReachableRange(origin, {
        timeBudgetInSec: 1800,
        vehicleEngineType: "combustion",
        constantSpeedConsumptionInLitersPerHundredkm: "50,6.3:130,11.5",
        accelerationEfficiency: 0.33,
        decelerationEfficiency: 0.83,
      })
    ).rejects.toThrow("vehicleWeight is required when using efficiency parameters");
    expect(requests).toHaveLength(0);
  });

  it("rejects combustion consumption options without the consumption curve", async () => {
    await expect(
      getReachableRange(origin, {
        timeBudgetInSec: 1800,
        vehicleEngineType: "combustion",
        auxiliaryPowerInLitersPerHour: 0.2,
      })
    ).rejects.toMatchObject({
      message: "A speed-consumption curve is required for these parameters",
      data: {
        required_param: "constantSpeedConsumptionInLitersPerHundredkm",
        params_needing_curve: ["auxiliaryPowerInLitersPerHour"],
      },
    });
    expect(requests).toHaveLength(0);
  });

  it("rejects an electric battery size without the consumption curve", async () => {
    await expect(
      getReachableRange(origin, {
        timeBudgetInSec: 1800,
        vehicleEngineType: "electric",
        maxChargeInkWh: 60,
      })
    ).rejects.toMatchObject({
      data: {
        required_param: "constantSpeedConsumptionInkWhPerHundredkm",
        params_needing_curve: ["maxChargeInkWh"],
      },
    });
    expect(requests).toHaveLength(0);
  });

  it.each([
    [
      { chargeBudgetPercent: 50 },
      "chargeBudgetPercent also needs vehicleEngineType='electric', maxChargeInkWh",
    ],
    [
      {
        remainingChargeBudgetPercent: 20,
        vehicleEngineType: "electric",
        constantSpeedConsumptionInkWhPerHundredkm: "50,8.2:130,21.3",
        maxChargeInkWh: 60,
      },
      "remainingChargeBudgetPercent also needs currentChargeInkWh",
    ],
  ] as const)(
    "rejects a charge budget without its battery parameters, by tool name",
    async (options, message) => {
      await expect(getReachableRange(origin, options)).rejects.toThrow(message);
      expect(requests).toHaveLength(0);
    }
  );

  it("sends the cost model and departure time", async () => {
    const { body } = await request({
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

  it("sends the EV route cost model and departure time", async () => {
    const body = await lastBody(() =>
      calculateEVRoute({
        origin: amsterdam,
        destination: utrecht,
        currentChargePercent: 80,
        maxChargeKWH: 75,
        routeType: "efficient",
        traffic: "live",
        avoid: ["motorways"],
        departAt: "2026-10-01T08:00:00Z",
      })
    );

    expect(body).toMatchObject({
      routeType: "efficient",
      traffic: "live",
      avoids: ["motorways"],
      departureDateTime: "2026-10-01T08:00:00.000Z",
    });
  });

  it("rejects an unknown avoid value before calling the API", async () => {
    await expect(getRoute([amsterdam, utrecht], { avoid: ["highways"] })).rejects.toMatchObject({
      message: "Unknown avoid values",
      data: { unknown_avoid: ["highways"] },
    });
    expect(requests).toHaveLength(0);
  });

  it("rejects more than five alternatives before calling the API", async () => {
    await expect(getRoute([amsterdam, utrecht], { maxAlternatives: 7 })).rejects.toThrow(
      "maxAlternatives must be a whole number from 0 to 5"
    );
    expect(requests).toHaveLength(0);
  });
});
