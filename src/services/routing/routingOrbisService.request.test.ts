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
import { calculateEVRoute, getReachableRange, getRoute } from "./routingOrbisService";
import type { ReachableRangeOptionsOrbis } from "./types";

vi.mock("../base/tomtomClient", () => ({ getEffectiveApiKey: () => "offline-test-key" }));

// Offline: stub fetch and inspect the URLs the SDK builds, so these tests check that
// vehicle options reach the TomTom API rather than being dropped by the SDK's request builder.
describe("Reachable range request parameters", () => {
  const origin = [4.89707, 52.377956];
  let requestedUrls: URL[];

  beforeEach(() => {
    requestedUrls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        requestedUrls.push(new URL(input instanceof Request ? input.url : input.toString()));
        return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function requestParams(options: ReachableRangeOptionsOrbis): Promise<URLSearchParams[]> {
    await getReachableRange(origin, options).catch(() => undefined);
    expect(requestedUrls.length).toBeGreaterThan(0);
    return requestedUrls.map((url) => url.searchParams);
  }

  it("sends vehicle max speed and weight without an engine type", async () => {
    const requests = await requestParams({
      timeBudgetInSec: 1800,
      vehicleMaxSpeed: 90,
      vehicleWeight: 3500,
    });

    for (const params of requests) {
      expect(params.get("vehicleMaxSpeed")).toBe("90");
      expect(params.get("vehicleWeight")).toBe("3500");
    }
  });

  it("sends combustion efficiency, max speed and weight", async () => {
    const requests = await requestParams({
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

    for (const params of requests) {
      expect(params.get("accelerationEfficiency")).toBe("0.33");
      expect(params.get("decelerationEfficiency")).toBe("0.83");
      expect(params.get("uphillEfficiency")).toBe("0.27");
      expect(params.get("downhillEfficiency")).toBe("0.51");
      expect(params.get("vehicleMaxSpeed")).toBe("110");
      expect(params.get("vehicleWeight")).toBe("1600");
    }
  });

  it("sends electric efficiency and weight", async () => {
    const requests = await requestParams({
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

    for (const params of requests) {
      expect(params.get("vehicleEngineType")).toBe("electric");
      expect(params.get("accelerationEfficiency")).toBe("0.66");
      expect(params.get("decelerationEfficiency")).toBe("0.91");
      expect(params.get("uphillEfficiency")).toBe("0.74");
      expect(params.get("downhillEfficiency")).toBe("0.73");
      expect(params.get("vehicleWeight")).toBe("1900");
    }
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
    expect(requestedUrls).toHaveLength(0);
  });

  it("rejects combustion consumption options without the consumption curve", async () => {
    await expect(
      getReachableRange(origin, {
        timeBudgetInSec: 1800,
        vehicleEngineType: "combustion",
        auxiliaryPowerInLitersPerHour: 0.2,
      })
    ).rejects.toThrow(
      "constantSpeedConsumptionInLitersPerHundredkm is required when using auxiliaryPowerInLitersPerHour"
    );
    expect(requestedUrls).toHaveLength(0);
  });

  it("rejects an electric battery size without the consumption curve", async () => {
    await expect(
      getReachableRange(origin, {
        timeBudgetInSec: 1800,
        vehicleEngineType: "electric",
        maxChargeInkWh: 60,
      })
    ).rejects.toThrow(
      "constantSpeedConsumptionInkWhPerHundredkm is required when using maxChargeInkWh"
    );
    expect(requestedUrls).toHaveLength(0);
  });

  it("sends the cost model and departure time", async () => {
    const requests = await requestParams({
      timeBudgetInSec: 1800,
      routeType: "short",
      traffic: "historical",
      avoid: ["tollRoads", "ferries"],
      departAt: "2026-10-01T08:00:00Z",
    });

    for (const params of requests) {
      expect(params.get("routeType")).toBe("short");
      expect(params.get("traffic")).toBe("historical");
      expect(params.getAll("avoid")).toEqual(["tollRoads", "ferries"]);
      expect(params.get("departAt")).toBe("2026-10-01T08:00:00.000Z");
    }
  });
});

// Route calculations are POSTs: inspect the JSON body the SDK builds.
describe("Route request bodies", () => {
  const amsterdam = [4.89707, 52.377956];
  const utrecht = [5.10962, 52.09083];
  let bodies: Record<string, unknown>[];

  beforeEach(() => {
    bodies = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(JSON.stringify({ routes: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function lastBody(call: () => Promise<unknown>): Promise<Record<string, unknown>> {
    await call().catch(() => undefined);
    expect(bodies.length).toBeGreaterThan(0);
    return bodies[bodies.length - 1];
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
    await expect(getRoute([amsterdam, utrecht], { avoid: ["highways"] })).rejects.toThrow(
      "Unknown avoid values: highways"
    );
    expect(bodies).toHaveLength(0);
  });

  it("rejects more than five alternatives before calling the API", async () => {
    await expect(getRoute([amsterdam, utrecht], { maxAlternatives: 7 })).rejects.toThrow(
      "maxAlternatives must be a whole number from 0 to 5"
    );
    expect(bodies).toHaveLength(0);
  });
});
