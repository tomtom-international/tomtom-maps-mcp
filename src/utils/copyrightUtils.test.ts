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

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGet = vi.fn();
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock("../services/base/tomtomClient", () => ({
  tomtomClient: { get: mockGet },
}));

vi.mock("./logger", () => ({
  logger: mockLogger,
}));

const { fetchCopyrightCaption, addCopyrightOverlay } = await import("./copyrightUtils");

describe("fetchCopyrightCaption", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch Orbis copyright caption", async () => {
    mockGet.mockResolvedValue({ data: { copyrightsCaption: "©TomTom, ©OSM" } });

    const result = await fetchCopyrightCaption(true);

    expect(result).toBe("©TomTom, ©OSM");
    expect(mockGet).toHaveBeenCalledWith(
      "maps/orbis/copyrights/caption.json",
      expect.objectContaining({ params: { apiVersion: 1 } })
    );
  });

  it("should fetch standard copyright caption", async () => {
    mockGet.mockResolvedValue({ data: { copyrightsCaption: "©TomTom" } });

    const result = await fetchCopyrightCaption(false);

    expect(result).toBe("©TomTom");
    expect(mockGet).toHaveBeenCalledWith(
      "map/2/copyrights/caption.json",
      expect.objectContaining({ params: {} })
    );
  });

  it("should return Orbis fallback when API response has no copyrightsCaption", async () => {
    mockGet.mockResolvedValue({ data: {} });

    const result = await fetchCopyrightCaption(true);

    expect(result).toBe("©TomTom, ©OpenStreetMap");
  });

  it("should return standard fallback when API response has no copyrightsCaption", async () => {
    mockGet.mockResolvedValue({ data: {} });

    const result = await fetchCopyrightCaption(false);

    expect(result).toBe("©TomTom");
  });

  it("should return Orbis fallback when API call throws", async () => {
    mockGet.mockRejectedValue(new Error("Network error"));

    const result = await fetchCopyrightCaption(true);

    expect(result).toBe("©TomTom, ©OpenStreetMap");
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("should return standard fallback when API call throws", async () => {
    mockGet.mockRejectedValue(new Error("Network error"));

    const result = await fetchCopyrightCaption(false);

    expect(result).toBe("©TomTom");
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});

describe("addCopyrightOverlay", () => {
  function createMockCtx() {
    return {
      font: "",
      textAlign: "",
      textBaseline: "",
      fillStyle: "" as string | object,
      measureText: vi.fn().mockReturnValue({ width: 100 }),
      fillRect: vi.fn(),
      fillText: vi.fn(),
    };
  }

  it("should set canvas properties and draw overlay at correct position", () => {
    const ctx = createMockCtx();
    // measureText returns width=100

    addCopyrightOverlay(ctx, "©TomTom", 800, 600);

    expect(ctx.font).toBe("bold 14px Arial");
    expect(ctx.textAlign).toBe("right");
    expect(ctx.textBaseline).toBe("bottom");
    expect(ctx.measureText).toHaveBeenCalledWith("©TomTom");

    // Background rect: textWidth(100) + padding(6)*2 = 112 wide, 16 + 12 = 28 tall
    // bgX = 800 - 112 - 100 = 588, bgY = 600 - 28 - 8 = 564
    expect(ctx.fillRect).toHaveBeenCalledWith(588, 564, 112, 28);

    // Text at: width - padding - 100 = 800 - 6 - 100 = 694, height - padding - 8 = 600 - 6 - 8 = 586
    expect(ctx.fillText).toHaveBeenCalledWith("©TomTom", 694, 586);
  });

  it("should use default text when copyrightText is empty", () => {
    const ctx = createMockCtx();

    addCopyrightOverlay(ctx, "", 800, 600);

    expect(ctx.measureText).toHaveBeenCalledWith("© TomTom");
    expect(ctx.fillText).toHaveBeenCalledWith("© TomTom", expect.any(Number), expect.any(Number));
  });
});
