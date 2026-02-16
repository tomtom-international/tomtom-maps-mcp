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

const createMocks = () => {
  const getRoute = vi.fn();
  const getMultiWaypointRoute = vi.fn();
  const getReachableRange = vi.fn();
  const loggerInfo = vi.fn();
  const loggerError = vi.fn();
  return {
    routingService: { getRoute, getMultiWaypointRoute, getReachableRange },
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
  getMultiWaypointRoute: mocks.routingService.getMultiWaypointRoute,
  getReachableRange: mocks.routingService.getReachableRange,
}));

vi.mock("../utils/logger", () => ({
  logger: mocks.logger,
}));

const { createRoutingHandler, createWaypointRoutingHandler, createReachableRangeHandler } =
  await import("./routingHandler");

describe("createRoutingHandler", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  it("should return route result for valid params", async () => {
    const fakeResult = { routes: [{ summary: {}, legs: [] }] };
    mocks.routingService.getRoute.mockResolvedValue(fakeResult);
    const handler = createRoutingHandler();
    const params = { origin: { lat: 1, lon: 2 }, destination: { lat: 3, lon: 4 } };
    const response = await handler(params);
    expect(mocks.routingService.getRoute).toHaveBeenCalled();
    expect(response.content[0].text).toContain("routes");
    expect(mocks.logger.info).toHaveBeenCalled();
    expect(mocks.logger.error).not.toHaveBeenCalled();
  });

  it("should handle errors from getRoute", async () => {
    mocks.routingService.getRoute.mockRejectedValue(new Error("fail"));
    const handler = createRoutingHandler();
    const params = { origin: { lat: 1, lon: 2 }, destination: { lat: 3, lon: 4 } };
    const response = await handler(params);
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("fail");
    expect(mocks.logger.error).toHaveBeenCalled();
  });
});

describe("createWaypointRoutingHandler", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  it("should return multi-waypoint route result for valid params", async () => {
    const fakeResult = { routes: [{ summary: {}, legs: [] }] };
    mocks.routingService.getMultiWaypointRoute.mockResolvedValue(fakeResult);
    const handler = createWaypointRoutingHandler();
    const params = {
      waypoints: [
        { lat: 1, lon: 2 },
        { lat: 3, lon: 4 },
      ],
    };
    const response = await handler(params);
    expect(mocks.routingService.getMultiWaypointRoute).toHaveBeenCalled();
    expect(response.content[0].text).toContain("routes");
    expect(mocks.logger.info).toHaveBeenCalled();
    expect(mocks.logger.error).not.toHaveBeenCalled();
  });

  it("should handle errors from getMultiWaypointRoute", async () => {
    mocks.routingService.getMultiWaypointRoute.mockRejectedValue(new Error("fail"));
    const handler = createWaypointRoutingHandler();
    const params = { waypoints: [{ lat: 1, lon: 2 }] };
    const response = await handler(params);
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("fail");
    expect(mocks.logger.error).toHaveBeenCalled();
  });
});

describe("createReachableRangeHandler", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  it("should return reachable range result for valid params", async () => {
    const fakeResult = { reachableRange: { center: { lat: 1, lon: 2 }, boundary: [] } };
    mocks.routingService.getReachableRange.mockResolvedValue(fakeResult);
    const handler = createReachableRangeHandler();
    const params = { origin: { lat: 1, lon: 2 }, timeBudgetInSec: 100 };
    const response = await handler(params);
    expect(mocks.routingService.getReachableRange).toHaveBeenCalled();
    expect(response.content[0].text).toContain("reachableRange");
    expect(mocks.logger.info).toHaveBeenCalled();
    expect(mocks.logger.error).not.toHaveBeenCalled();
  });

  it("should handle errors from getReachableRange", async () => {
    mocks.routingService.getReachableRange.mockRejectedValue(new Error("fail"));
    const handler = createReachableRangeHandler();
    const params = { origin: { lat: 1, lon: 2 } };
    const response = await handler(params);
    expect(response.isError).toBe(true);
    expect(typeof response.content[0].text).toBe("string");
  });
});
