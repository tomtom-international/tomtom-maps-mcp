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
import type { ReachableRangeParams } from "../schemas/routing/routingSchema";
import { expectDropped, expectKept, loadFixture } from "./shared/__fixtures__";

const createMocks = () => {
  const getRoute = vi.fn();
  const getReachableRange = vi.fn();
  const loggerInfo = vi.fn();
  const loggerError = vi.fn();
  return {
    routingService: { getRoute, getReachableRange },
    logger: {
      info: loggerInfo,
      error: loggerError,
      warn: vi.fn(),
      debug: vi.fn(),
    },
  };
};

const mocks = createMocks();

vi.mock("../services/routing/routingService", () => ({
  getRoute: mocks.routingService.getRoute,
  getReachableRange: mocks.routingService.getReachableRange,
}));

vi.mock("../utils/logger", () => ({
  logger: mocks.logger,
}));

const { createRoutingHandler, createReachableRangeHandler } = await import("./routingHandler");

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
    const fakeResult = {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {} }],
    };
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
    expect(response.content[0].text).toContain("FeatureCollection");
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

  const fakeReachableRanges = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [2.1, 1.1],
              [2.2, 1.2],
              [2.1, 1.1],
            ],
          ],
        },
        properties: { budget: { type: "timeMinutes", value: 30 }, origin: [2, 1] },
      },
    ],
  };

  it("should return reachable range result for valid params with time budget", async () => {
    const fakeResult = loadFixture("orbis-reachable-range");
    mocks.routingService.getReachableRange.mockResolvedValue(fakeResult);

    const handler = createReachableRangeHandler();
    const params = {
      origin: { lat: 1, lon: 2 },
      timeBudgetInSec: 3600,
    } as unknown as ReachableRangeParams;

    const response = await handler(params);

    expect(mocks.routingService.getReachableRange).toHaveBeenCalledWith(params.origin, params);
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.features).toHaveLength(1);
    expect(parsed.features[0].properties.budget).toEqual({ type: "timeMinutes", value: 60 });
    expect(parsed.features[0].geometry.coordinates).toBeUndefined();
    expect(response.content[0].text).not.toContain("test-api-key");
    expect(mocks.logger.info).toHaveBeenCalled();
    expect(mocks.logger.error).not.toHaveBeenCalled();
  });

  it("should return reachable range result for valid params with distance budget", async () => {
    mocks.routingService.getReachableRange.mockResolvedValue(fakeReachableRanges);

    const handler = createReachableRangeHandler();
    const params = {
      origin: { lat: 1, lon: 2 },
      distanceBudgetInMeters: 10000, // 10 km
    } as unknown as ReachableRangeParams;

    const response = await handler(params);

    expect(mocks.routingService.getReachableRange).toHaveBeenCalled();
    expect(JSON.parse(response.content[0].text).features[0].properties.budget).toEqual({
      type: "timeMinutes",
      value: 30,
    });
    expect(mocks.logger.info).toHaveBeenCalled();
  });

  it("should handle errors from getReachableRange", async () => {
    mocks.routingService.getReachableRange.mockRejectedValue(new Error("calculation failed"));

    const handler = createReachableRangeHandler();
    const params = {
      origin: { lat: 1, lon: 2 },
      timeBudgetInSec: 1800,
    } as unknown as ReachableRangeParams;

    const response = await handler(params);

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("calculation failed");
    expect(mocks.logger.error).toHaveBeenCalled();
  });
});
