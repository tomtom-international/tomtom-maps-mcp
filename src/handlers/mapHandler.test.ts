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

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/map/dynamicMapService", () => ({
  renderDynamicMap: vi.fn(),
}));

vi.mock("../services/cache/vizCache", () => ({
  storeVizData: vi.fn(),
}));

vi.mock("../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockRenderDynamicMap = vi.fn();
const mockStoreVizData = vi.fn();
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

let createDynamicMapHandler: typeof import("./mapHandler").createDynamicMapHandler;

beforeEach(async () => {
  vi.clearAllMocks();

  const { renderDynamicMap } = await import("../services/map/dynamicMapService");
  const { storeVizData } = await import("../services/cache/vizCache");
  const { logger } = await import("../utils/logger");

  vi.mocked(renderDynamicMap).mockImplementation(mockRenderDynamicMap);
  vi.mocked(storeVizData).mockImplementation(mockStoreVizData);
  vi.mocked(logger.info).mockImplementation(mockLogger.info);
  vi.mocked(logger.error).mockImplementation(mockLogger.error);
  vi.mocked(logger.warn).mockImplementation(mockLogger.warn);
  vi.mocked(logger.debug).mockImplementation(mockLogger.debug);

  mockStoreVizData.mockResolvedValue("viz-123");

  const mod = await import("./mapHandler");
  createDynamicMapHandler = mod.createDynamicMapHandler;
});

const fakeRenderResult = {
  summary: {
    view: { center: [4.89, 52.37], zoom: 10 },
    markers: [{ label: "Amsterdam", position: [4.89, 52.37] }],
  },
  mapState: {
    view: { center: [4.89, 52.37], zoom: 10 },
    sources: { markers: { type: "geojson", data: {} } },
  },
};

function parseResponse(response: { content: Array<{ type: string; text?: string }> }) {
  expect(response.content).toHaveLength(1);
  return JSON.parse(response.content[0].text as string);
}

describe("createDynamicMapHandler", () => {
  it("should give the agent the map summary, with no image", async () => {
    mockRenderDynamicMap.mockResolvedValue(fakeRenderResult);

    const handler = createDynamicMapHandler();
    const response = await handler({ markers: [{ lat: 52.37, lon: 4.89 }] });

    expect(response.content.every((c) => c.type === "text")).toBe(true);
    expect(parseResponse(response)).toMatchObject(fakeRenderResult.summary);
  });

  it("should cache map state and include viz_id by default", async () => {
    mockRenderDynamicMap.mockResolvedValue(fakeRenderResult);

    const handler = createDynamicMapHandler();
    const response = await handler({ markers: [{ lat: 52.37, lon: 4.89 }] });

    expect(mockStoreVizData).toHaveBeenCalledWith(fakeRenderResult.mapState);
    expect(parseResponse(response)._meta).toEqual({ show_ui: true, viz_id: "viz-123" });
  });

  it("should not cache map state when show_ui is false", async () => {
    mockRenderDynamicMap.mockResolvedValue(fakeRenderResult);

    const handler = createDynamicMapHandler();
    const response = await handler({ markers: [{ lat: 52.37, lon: 4.89 }], show_ui: false });

    expect(mockStoreVizData).not.toHaveBeenCalled();
    const result = parseResponse(response);
    expect(result._meta).toEqual({ show_ui: false });
    expect(result.markers).toEqual(fakeRenderResult.summary.markers);
  });

  it("should return an error for failures", async () => {
    mockRenderDynamicMap.mockRejectedValue(new Error("Something went wrong"));

    const handler = createDynamicMapHandler();
    const response = await handler({
      markers: [{ lat: 52.37, lon: 4.89 }],
    });

    expect(response.isError).toBe(true);
    const errContent = response.content[0] as { type: "text"; text: string };
    const result = JSON.parse(errContent.text);
    expect(result.error).toBe("Something went wrong");
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
