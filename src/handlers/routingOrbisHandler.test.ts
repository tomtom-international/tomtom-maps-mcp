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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  EvRoutingOrbisParams,
  ReachableRangeOrbisParams,
} from "../schemas/routing/routingOrbisSchema";
import { expectDropped, expectKept, loadFixture } from "./shared/__fixtures__";

const createMocks = () => {
  const getRoute = vi.fn();
  const getReachableRange = vi.fn();
  const calculateEVRoute = vi.fn();
  const loggerInfo = vi.fn();
  const loggerError = vi.fn();
  return {
    routingService: { getRoute, getReachableRange, calculateEVRoute },
    logger: {
      info: loggerInfo,
      error: loggerError,
      warn: vi.fn(),
      debug: vi.fn(),
    },
  };
};

const mocks = createMocks();

vi.mock("../services/routing/routingOrbisService", () => ({
  getRoute: mocks.routingService.getRoute,
  getReachableRange: mocks.routingService.getReachableRange,
  calculateEVRoute: mocks.routingService.calculateEVRoute,
}));

vi.mock("../utils/logger", () => ({
  logger: mocks.logger,
}));

const { createRoutingHandler, createReachableRangeHandler, createEVRoutingHandler } = await import(
  "./routingOrbisHandler"
);

describe("createRoutingHandler", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  it("should return route result for valid params", async () => {
    const fakeResult = loadFixture("orbis-route");
    mocks.routingService.getRoute.mockResolvedValue(fakeResult);
    const handler = createRoutingHandler();
    const params = {
      locations: [
        [1, 2],
        [3, 4],
      ],
    };
    const response = await handler(params);
    expect(mocks.routingService.getRoute).toHaveBeenCalled();
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.features[0].properties.summary).toEqual(
      fakeResult.features[0].properties.summary
    );
    expect(parsed.features[0].geometry.coordinates).toBeUndefined();
    expect(mocks.logger.info).toHaveBeenCalled();
    expect(mocks.logger.error).not.toHaveBeenCalled();
  });

  it("should return multi-stop route result for 3+ locations", async () => {
    const fakeResult = { routes: [{ summary: {}, legs: [] }] };
    mocks.routingService.getRoute.mockResolvedValue(fakeResult);
    const handler = createRoutingHandler();
    const params = {
      locations: [
        [1, 2],
        [2, 3],
        [3, 4],
      ],
    };
    const response = await handler(params);
    expect(mocks.routingService.getRoute).toHaveBeenCalled();
    expect(response.content[0].text).toContain("routes");
  });

  it("should handle errors from getRoute", async () => {
    mocks.routingService.getRoute.mockRejectedValue(new Error("fail"));
    const handler = createRoutingHandler();
    const params = {
      locations: [
        [1, 2],
        [3, 4],
      ],
    };
    const response = await handler(params);
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("fail");
    expect(mocks.logger.error).toHaveBeenCalled();
  });
});

describe("createReachableRangeHandler", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  it("should return reachable range result for valid params with time budget", async () => {
    const fakeResult = loadFixture("orbis-reachable-range");
    mocks.routingService.getReachableRange.mockResolvedValue(fakeResult);

    const handler = createReachableRangeHandler();
    const params = {
      origin: { lat: 1, lon: 2 },
      timeBudgetInSec: 1800, // 30 minutes
    } as unknown as ReachableRangeOrbisParams;

    const response = await handler(params);

    expect(mocks.routingService.getReachableRange).toHaveBeenCalled();
    expect(mocks.routingService.getReachableRange).toHaveBeenCalledWith(params.origin, params);
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.features).toHaveLength(fakeResult.features.length);
    expect(parsed.features[0].geometry.coordinates).toBeUndefined();
    expect(response.content[0].text).not.toContain("test-api-key");
    expect(mocks.logger.info).toHaveBeenCalled();
    expect(mocks.logger.error).not.toHaveBeenCalled();
  });

  it("should return reachable range result for valid params with distance budget", async () => {
    const fakeResult = {
      reachableRange: {
        center: { latitude: 1, longitude: 2 },
        boundary: [
          { latitude: 1.1, longitude: 2.1 },
          { latitude: 1.2, longitude: 2.2 },
        ],
      },
    };
    mocks.routingService.getReachableRange.mockResolvedValue(fakeResult);

    const handler = createReachableRangeHandler();
    const params = {
      origin: { lat: 1, lon: 2 },
      distanceBudgetInMeters: 10000, // 10 km
    } as unknown as ReachableRangeOrbisParams;

    const response = await handler(params);

    expect(mocks.routingService.getReachableRange).toHaveBeenCalled();
    expect(response.content[0].text).toContain("reachableRange");
    expect(mocks.logger.info).toHaveBeenCalled();
  });

  it("should handle errors from getReachableRange", async () => {
    mocks.routingService.getReachableRange.mockRejectedValue(new Error("calculation failed"));

    const handler = createReachableRangeHandler();
    const params = {
      origin: { lat: 1, lon: 2 },
      timeBudgetInSec: 1800,
    } as unknown as ReachableRangeOrbisParams;

    const response = await handler(params);

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("calculation failed");
    expect(mocks.logger.error).toHaveBeenCalled();
  });

  it("should return error when no budget parameter is provided", async () => {
    const handler = createReachableRangeHandler();
    const params = {
      origin: { lat: 1, lon: 2 },
      // No budget parameter
    } as unknown as ReachableRangeOrbisParams;

    const response = await handler(params);

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("budget parameter");
    // getReachableRange should not be called if validation fails
    expect(mocks.routingService.getReachableRange).not.toHaveBeenCalled();
  });
});

describe("createEVRoutingHandler", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  const params = {
    origin: [4.9041, 52.3676],
    destination: [13.405, 52.52],
    currentChargePercent: 80,
    maxChargeKWH: 75,
    show_ui: false,
  } as unknown as EvRoutingOrbisParams;

  it("should trim the SDK EV route shape (fixture)", async () => {
    const fakeResult = loadFixture("orbis-ev-route");
    mocks.routingService.calculateEVRoute.mockResolvedValue(fakeResult);

    const response = await createEVRoutingHandler()(params);
    const parsed = JSON.parse(response.content[0].text);
    const legs = "features[].properties.sections.leg[]";

    expectDropped(fakeResult, parsed, [
      "features[].properties.progress",
      `${legs}.id`,
      `${legs}.startPointIndex`,
      `${legs}.endPointIndex`,
      `${legs}.summary.chargingInformationAtEndOfLeg.properties.chargingParkUuid`,
      `${legs}.summary.chargingInformationAtEndOfLeg.properties.nearbyServices`,
    ]);
    const stop = `${legs}.summary.chargingInformationAtEndOfLeg.properties`;
    expectKept(parsed, [
      "features[].properties.summary.totalChargingTimeInSeconds",
      `${legs}.summary.remainingChargeAtArrivalInPCT`,
      `${stop}.chargingParkName`,
      `${stop}.chargingTimeInSeconds`,
      // Operator, speed, target charge, plug and kW
      `${stop}.chargingParkOperatorName`,
      `${stop}.chargingParkSpeed`,
      `${stop}.targetChargeInPCT`,
      `${stop}.chargingConnectionInfo.plugType`,
      `${stop}.chargingConnectionInfo.chargingPowerInkW`,
      // Traffic on the way, as in routing
      "features[].properties.sections.traffic[].delayInSeconds",
    ]);
    expectDropped(fakeResult, parsed, [
      `${stop}.chargingConnectionInfo.voltageInV`,
      "features[].properties.sections.traffic[].tec",
    ]);
  });

  it("should trim EV route sections the same way as routing (fixture)", async () => {
    const fakeResult = loadFixture("orbis-ev-route");
    mocks.routingService.calculateEVRoute.mockResolvedValue(fakeResult);

    const response = await createEVRoutingHandler()(params);
    const parsed = JSON.parse(response.content[0].text);
    const sections = "features[].properties.sections";

    expectDropped(fakeResult, parsed, [
      "features[].bbox",
      `${sections}.speedLimit`,
      `${sections}.roadShields`,
      `${sections}.urban`,
      `${sections}.motorway`,
    ]);
    expectKept(parsed, [
      `${sections}.country[].countryCodeISO3`,
      `${sections}.importantRoadStretch[].roadNumbers`,
    ]);
  });
});
