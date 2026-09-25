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

const { fetchCopyrightCaption } = await import("./copyrightUtils");

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
