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
import { loadFixture } from "./shared/__fixtures__";

const createMocks = () => {
  const getRoute = vi.fn();
  const loggerInfo = vi.fn();
  const loggerError = vi.fn();
  return {
    routingService: { getRoute },
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
}));

vi.mock("../utils/logger", () => ({
  logger: mocks.logger,
}));

const { createRoutingHandler } = await import("./routingHandler");

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
