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
import type { TrafficParams } from "../schemas/traffic/trafficSchema";

const createMocks = () => {
  const getTrafficIncidents = vi.fn();
  const loggerInfo = vi.fn();
  const loggerError = vi.fn();
  return {
    trafficService: { getTrafficIncidents },
    logger: {
      info: loggerInfo,
      error: loggerError,
      warn: vi.fn(),
      debug: vi.fn(),
    },
  };
};

const mocks = createMocks();

vi.mock("../services/traffic/trafficService", () => ({
  getTrafficIncidents: mocks.trafficService.getTrafficIncidents,
}));

vi.mock("../utils/logger", () => ({
  logger: mocks.logger,
}));

const { createTrafficHandler } = await import("./trafficHandler");

describe("createTrafficHandler", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  it("should return traffic incidents for valid params", async () => {
    mocks.trafficService.getTrafficIncidents.mockResolvedValue({ incidents: [{ id: 1 }] });
    const handler = createTrafficHandler();
    const params: TrafficParams = { bbox: [1, 2, 3, 4] };
    const response = await handler(params);
    expect(mocks.trafficService.getTrafficIncidents).toHaveBeenCalled();
    expect(response.content[0].text).toContain("incidents");
    expect(mocks.logger.info).toHaveBeenCalled();
    expect(mocks.logger.error).not.toHaveBeenCalled();
  });

  it("should pass every lookup option through to the service", async () => {
    mocks.trafficService.getTrafficIncidents.mockResolvedValue({ incidents: [] });
    const handler = createTrafficHandler();
    const options = {
      language: "nl-NL",
      categoryFilter: "0,8",
      timeValidityFilter: "present",
      maxResults: 5,
      fields: "{incidents{type}}",
    };
    await handler({ bbox: [1, 2, 3, 4], show_ui: false, response_detail: "full", ...options });
    expect(mocks.trafficService.getTrafficIncidents).toHaveBeenCalledWith([1, 2, 3, 4], options);
  });

  it("should reject a lookup without a bbox", async () => {
    const response = await createTrafficHandler()({});
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("bbox parameter must be provided");
    expect(mocks.trafficService.getTrafficIncidents).not.toHaveBeenCalled();
  });

  it("should handle errors from getTrafficIncidents", async () => {
    mocks.trafficService.getTrafficIncidents.mockRejectedValue(new Error("fail"));
    const handler = createTrafficHandler();
    const params: TrafficParams = { bbox: [1, 2, 3, 4] };
    const response = await handler(params);
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("fail");
    expect(mocks.logger.error).toHaveBeenCalled();
  });
});
