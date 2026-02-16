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
  const getStaticMapImage = vi.fn();
  const loggerInfo = vi.fn();
  const loggerError = vi.fn();
  return {
    mapService: { getStaticMapImage },
    logger: {
      info: loggerInfo,
      error: loggerError,
      warn: vi.fn(),
      debug: vi.fn(),
    },
  };
};

const mocks = createMocks();

vi.mock("../services/map/mapService", () => ({
  getStaticMapImage: mocks.mapService.getStaticMapImage,
}));

vi.mock("../utils/logger", () => ({
  logger: mocks.logger,
}));

const { createStaticMapHandler } = await import("./mapHandler");

describe("createStaticMapHandler", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  it("should return image result for valid params", async () => {
    mocks.mapService.getStaticMapImage.mockResolvedValue({
      base64: "imgdata",
      contentType: "image/png",
    });
    const handler = createStaticMapHandler();
    const params = { center: { lat: 1, lon: 2 } };
    const response = await handler(params);
    expect(mocks.mapService.getStaticMapImage).toHaveBeenCalled();
    expect(response.content[0].type).toBe("image");
    expect(mocks.logger.info).toHaveBeenCalled();
    expect(mocks.logger.error).not.toHaveBeenCalled();
  });

  it("should handle errors from getStaticMapImage", async () => {
    mocks.mapService.getStaticMapImage.mockRejectedValue(new Error("fail"));
    const handler = createStaticMapHandler();
    const params = { center: { lat: 1, lon: 2 } };
    const response = await handler(params);
    expect(response.isError).toBe(true);
    // Check that the returned content is a text error
    if (response.content[0].type === "text") {
      expect(response.content[0].text).toContain("fail");
    } else {
      throw new Error("Expected error response to be of type text");
    }
    expect(mocks.logger.error).toHaveBeenCalled();
  });
});
