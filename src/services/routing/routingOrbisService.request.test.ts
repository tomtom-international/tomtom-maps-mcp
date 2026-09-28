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
import { getReachableRange } from "./routingOrbisService";
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
});
