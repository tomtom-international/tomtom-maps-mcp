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

  async function requestParams(options: ReachableRangeOptions): Promise<URLSearchParams> {
    await getReachableRange(origin, options).catch(() => undefined);
    expect(requests).toHaveLength(1);
    return requests[0].url.searchParams;
  }

  it("sends vehicle max speed and weight without an engine type", async () => {
    const params = await requestParams({
      timeBudgetInSec: 1800,
      vehicleMaxSpeed: 90,
      vehicleWeight: 3500,
    });

    expect(params.get("vehicleMaxSpeed")).toBe("90");
    expect(params.get("vehicleWeight")).toBe("3500");
  });

  it("sends combustion efficiency, max speed and weight", async () => {
    const params = await requestParams({
      fuelBudgetInLiters: 5,
      vehicleEngineType: "combustion",
      constantSpeedConsumptionInLitersPerHundredkm: "50,6.3:130,11.5",
      fuelEnergyDensityInMJoulesPerLiter: 34.2,
      accelerationEfficiency: 0.33,
      decelerationEfficiency: 0.83,
      uphillEfficiency: 0.27,
      downhillEfficiency: 0.51,
      vehicleMaxSpeed: 110,
      vehicleWeight: 1600,
    });

    expect(params.get("accelerationEfficiency")).toBe("0.33");
    expect(params.get("decelerationEfficiency")).toBe("0.83");
    expect(params.get("uphillEfficiency")).toBe("0.27");
    expect(params.get("downhillEfficiency")).toBe("0.51");
    expect(params.get("fuelEnergyDensityInMJoulesPerLiter")).toBe("34.2");
    expect(params.get("vehicleMaxSpeed")).toBe("110");
    expect(params.get("vehicleWeight")).toBe("1600");
  });

  it("sends electric efficiency and weight", async () => {
    const params = await requestParams({
      energyBudgetInkWh: 10,
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

    expect(params.get("vehicleEngineType")).toBe("electric");
    expect(params.get("accelerationEfficiency")).toBe("0.66");
    expect(params.get("decelerationEfficiency")).toBe("0.91");
    expect(params.get("uphillEfficiency")).toBe("0.74");
    expect(params.get("downhillEfficiency")).toBe("0.73");
    expect(params.get("vehicleWeight")).toBe("1900");
  });

  it.each([
    [
      "an unpaired efficiency",
      { vehicleWeight: 1600, fuelEnergyDensityInMJoulesPerLiter: 34, uphillEfficiency: 0.27 },
      "uphillEfficiency and downhillEfficiency go together",
    ],
    [
      "an unpaired acceleration efficiency",
      { vehicleWeight: 1600, fuelEnergyDensityInMJoulesPerLiter: 34, accelerationEfficiency: 0.33 },
      "accelerationEfficiency and decelerationEfficiency go together",
    ],
    [
      "combustion efficiency without the fuel energy density",
      { vehicleWeight: 1600, accelerationEfficiency: 0.33, decelerationEfficiency: 0.83 },
      "fuelEnergyDensityInMJoulesPerLiter and the efficiency parameters go together",
    ],
    [
      "a fuel energy density without efficiency",
      { fuelEnergyDensityInMJoulesPerLiter: 34 },
      "fuelEnergyDensityInMJoulesPerLiter and the efficiency parameters go together",
    ],
  ])("rejects %s before calling the API", async (_name, extra, message) => {
    await expect(
      getReachableRange(origin, {
        fuelBudgetInLiters: 5,
        vehicleEngineType: "combustion",
        constantSpeedConsumptionInLitersPerHundredkm: "50,6.3:130,11.5",
        ...extra,
      })
    ).rejects.toThrow(message);
    expect(requests).toHaveLength(0);
  });

  it("rejects efficiency parameters without a vehicle weight before calling the API", async () => {
    await expect(
      getReachableRange(origin, {
        fuelBudgetInLiters: 5,
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
        fuelBudgetInLiters: 5,
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
        energyBudgetInkWh: 10,
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

  it("sends the current charge in kWh as given", async () => {
    const params = await requestParams({
      energyBudgetInkWh: 10,
      vehicleEngineType: "electric",
      constantSpeedConsumptionInkWhPerHundredkm: "50,8.2:130,21.3",
      maxChargeInkWh: 75,
      currentChargeInkWh: 37,
    });

    expect(params.get("currentChargeInkWh")).toBe("37");
    expect(params.get("maxChargeInkWh")).toBe("75");
  });

  it("budgets the charge above the remaining percentage", async () => {
    const params = await requestParams({
      remainingChargeBudgetPercent: 20,
      vehicleEngineType: "electric",
      constantSpeedConsumptionInkWhPerHundredkm: "50,8.2:130,21.3",
      maxChargeInkWh: 75,
      currentChargeInkWh: 37,
    });

    expect(Number(params.get("currentChargeInkWh"))).toBeCloseTo(37);
    expect(Number(params.get("energyBudgetInkWh"))).toBeCloseTo(37 - 15);
  });

  it("budgets a percentage of the battery", async () => {
    const params = await requestParams({
      chargeBudgetPercent: 40,
      vehicleEngineType: "electric",
      constantSpeedConsumptionInkWhPerHundredkm: "50,8.2:130,21.3",
      maxChargeInkWh: 75,
      currentChargeInkWh: 37,
    });

    expect(Number(params.get("energyBudgetInkWh"))).toBeCloseTo(30);
  });

  it.each([
    ["a battery size without the current charge", undefined],
    ["an empty battery", 0],
    ["more charge than the battery holds", 80],
  ])("rejects %s before calling the API", async (_name, currentChargeInkWh) => {
    await expect(
      getReachableRange(origin, {
        energyBudgetInkWh: 10,
        vehicleEngineType: "electric",
        constantSpeedConsumptionInkWhPerHundredkm: "50,8.2:130,21.3",
        maxChargeInkWh: 75,
        currentChargeInkWh,
      })
    ).rejects.toThrow("currentChargeInkWh and maxChargeInkWh go together");
    expect(requests).toHaveLength(0);
  });

  it.each([
    ["chargeBudgetPercent", { chargeBudgetPercent: 20 }],
    ["remainingChargeBudgetPercent", { remainingChargeBudgetPercent: 20 }],
  ])("rejects %s without the battery size before calling the API", async (budget, options) => {
    await expect(
      getReachableRange(origin, { vehicleEngineType: "electric", ...options })
    ).rejects.toThrow(`maxChargeInkWh is required when using ${budget}`);
    expect(requests).toHaveLength(0);
  });

  it.each([
    [
      "two budgets",
      { timeBudgetInSec: 1800, distanceBudgetInMeters: 5000 },
      "Give one budget parameter",
    ],
    [
      "an energy budget above the current charge",
      { energyBudgetInkWh: 50, maxChargeInkWh: 75, currentChargeInkWh: 37 },
      "The charge budget exceeds the current charge",
    ],
    [
      "a charge budget above the current charge",
      { chargeBudgetPercent: 60, maxChargeInkWh: 75, currentChargeInkWh: 37 },
      "The charge budget exceeds the current charge",
    ],
    [
      "a remaining charge without the current charge",
      { remainingChargeBudgetPercent: 20, maxChargeInkWh: 75 },
      "currentChargeInkWh and maxChargeInkWh go together",
    ],
    [
      "a remaining charge at or above the current charge",
      { remainingChargeBudgetPercent: 60, maxChargeInkWh: 75, currentChargeInkWh: 37 },
      "The charge budget exceeds the current charge",
    ],
  ])("rejects %s before calling the API", async (_name, options, message) => {
    await expect(
      getReachableRange(origin, {
        vehicleEngineType: "electric",
        constantSpeedConsumptionInkWhPerHundredkm: "50,8.2:130,21.3",
        ...options,
      })
    ).rejects.toThrow(message);
    expect(requests).toHaveLength(0);
  });

  it.each([
    ["timeBudgetInSec", { timeBudgetInSec: 1800 }],
    ["distanceBudgetInMeters", { distanceBudgetInMeters: 10000 }],
  ])("rejects the consumption model with %s, which ignores it", async (_budget, budget) => {
    await expect(
      getReachableRange(origin, {
        ...budget,
        vehicleEngineType: "electric",
        constantSpeedConsumptionInkWhPerHundredkm: "50,8.2:130,21.3",
        vehicleWeight: 1600,
      })
    ).rejects.toMatchObject({
      data: { ignored_params: ["vehicleEngineType", "constantSpeedConsumptionInkWhPerHundredkm"] },
    });
    expect(requests).toHaveLength(0);
  });

  it("rejects a fuel level without the consumption curve before calling the API", async () => {
    await expect(
      getReachableRange(origin, {
        fuelBudgetInLiters: 5,
        vehicleEngineType: "combustion",
        currentFuelInLiters: 40,
      })
    ).rejects.toMatchObject({
      data: { params_needing_curve: ["currentFuelInLiters"] },
    });
    expect(requests).toHaveLength(0);
  });

  it("sends the cost model and departure time", async () => {
    const params = await requestParams({
      timeBudgetInSec: 1800,
      routeType: "short",
      traffic: "historical",
      avoid: ["tollRoads", "ferries"],
      departAt: "2026-10-01T08:00:00Z",
    });

    expect(params.get("routeType")).toBe("short");
    expect(params.get("traffic")).toBe("historical");
    expect(params.getAll("avoid")).toEqual(["tollRoads", "ferries"]);
    expect(params.get("departAt")).toBe("2026-10-01T08:00:00.000Z");
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

  it("rejects a battery size without the consumption curve before calling the API", async () => {
    await expect(
      getRoute([amsterdam, utrecht], { vehicleEngineType: "electric", maxChargeInkWh: 75 })
    ).rejects.toMatchObject({
      data: {
        required_param: "constantSpeedConsumptionInkWhPerHundredkm",
        params_needing_curve: ["maxChargeInkWh"],
      },
    });
    expect(requests).toHaveLength(0);
  });

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

  it("rejects more than five alternatives before calling the API", async () => {
    await expect(getRoute([amsterdam, utrecht], { maxAlternatives: 7 })).rejects.toThrow(
      "maxAlternatives must be a whole number from 0 to 5"
    );
    expect(requests).toHaveLength(0);
  });
  it("sends the vehicle and its electric consumption model", async () => {
    const body = await lastBody(() =>
      getRoute([amsterdam, utrecht], {
        vehicleMaxSpeed: 90,
        vehicleWeight: 2000,
        vehicleEngineType: "electric",
        maxChargeInkWh: 60,
        constantSpeedConsumptionInkWhPerHundredkm: "50,8:130,18",
        consumptionInkWhPerkmAltitudeGain: 7,
        recuperationInkWhPerkmAltitudeLoss: 3,
      })
    );
    const query = requests[requests.length - 1].url.searchParams;

    expect(body).toMatchObject({
      vehicleEngineType: "electric",
      vehicleWeightInKilograms: 2000,
      vehicleMaxSpeedInKilometersPerHour: 90,
    });
    expect(query.get("constantSpeedConsumptionInkWhPerHundredkm")).toBe("50,8:130,18");
    expect(query.get("maxChargeInkWh")).toBe("60");
    // The API needs a charge with the battery size, and ignores it for a route
    expect(query.get("currentChargeInkWh")).toBe("60");
    expect(query.get("consumptionInkWhPerkmAltitudeGain")).toBe("7");
    expect(query.get("recuperationInkWhPerkmAltitudeLoss")).toBe("3");
  });

  it("rejects half of the altitude pair before calling the API", async () => {
    await expect(
      getRoute([amsterdam, utrecht], {
        vehicleEngineType: "electric",
        constantSpeedConsumptionInkWhPerHundredkm: "50,8:130,18",
        consumptionInkWhPerkmAltitudeGain: 7,
      })
    ).rejects.toThrow(
      "consumptionInkWhPerkmAltitudeGain and recuperationInkWhPerkmAltitudeLoss go together"
    );
    expect(requests).toHaveLength(0);
  });

  it("rejects the altitude pair with efficiency parameters before calling the API", async () => {
    await expect(
      getRoute([amsterdam, utrecht], {
        vehicleEngineType: "electric",
        vehicleWeight: 2000,
        constantSpeedConsumptionInkWhPerHundredkm: "50,8:130,18",
        uphillEfficiency: 0.7,
        downhillEfficiency: 0.7,
        consumptionInkWhPerkmAltitudeGain: 7,
        recuperationInkWhPerkmAltitudeLoss: 3,
      })
    ).rejects.toThrow("The altitude parameters cannot be combined with efficiency parameters");
    expect(requests).toHaveLength(0);
  });

  it.each([
    [
      "no engine type",
      { constantSpeedConsumptionInkWhPerHundredkm: "50,8:130,18", uphillEfficiency: 0.7 },
      {
        params_needing_electric: ["constantSpeedConsumptionInkWhPerHundredkm"],
        params_needing_engine_type: ["uphillEfficiency"],
      },
    ],
    [
      "the other engine type",
      { vehicleEngineType: "combustion" as const, maxChargeInkWh: 60 },
      { vehicleEngineType: "combustion", params_needing_electric: ["maxChargeInkWh"] },
    ],
  ])("rejects engine inputs with %s before calling the API", async (_name, options, data) => {
    const call = getRoute([amsterdam, utrecht], { vehicleWeight: 2000, ...options });
    await expect(call).rejects.toMatchObject({
      message: "These vehicle parameters need a matching vehicleEngineType",
    });
    await expect(call).rejects.toHaveProperty("data", data);
    expect(requests).toHaveLength(0);
  });
});
