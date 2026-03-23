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
import { renderDynamicMap } from "./dynamicMapService";
import type { DynamicMapOptions } from "./dynamicMapTypes";
import { tomtomClient } from "../base/tomtomClient";
import type { BBox } from "@tomtom-org/maps-sdk/core";

// Create a small 1x1 PNG buffer for mock tile responses
const MOCK_PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64"
);

// Mock skia-canvas
const mockCanvasContext = {
  fillRect: vi.fn(),
  fillText: vi.fn(),
  measureText: vi.fn(() => ({ width: 50 })),
  drawImage: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  bezierCurveTo: vi.fn(),
  rect: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  getContext: vi.fn(),
  set fillStyle(_v: unknown) {},
  get fillStyle() {
    return "#000";
  },
  set strokeStyle(_v: unknown) {},
  get strokeStyle() {
    return "#000";
  },
  set lineWidth(_v: unknown) {},
  get lineWidth() {
    return 1;
  },
  set lineJoin(_v: unknown) {},
  set lineCap(_v: unknown) {},
  set font(_v: unknown) {},
  set textAlign(_v: unknown) {},
  set textBaseline(_v: unknown) {},
  set shadowColor(_v: unknown) {},
  set shadowBlur(_v: unknown) {},
  set shadowOffsetX(_v: unknown) {},
  set shadowOffsetY(_v: unknown) {},
  set globalAlpha(_v: unknown) {},
  get globalAlpha() {
    return 1;
  },
};

vi.mock("skia-canvas", () => {
  return {
    Canvas: class MockCanvas {
      width: number;
      height: number;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        return mockCanvasContext;
      }
      async toBuffer() {
        return Buffer.from("fake-png-data");
      }
    },
    loadImage: vi.fn().mockResolvedValue({
      width: 256,
      height: 256,
    }),
    Path2D: class MockPath2D {
      constructor(_d?: string) {}
    },
  };
});

vi.mock("../base/tomtomClient", () => ({
  validateApiKey: vi.fn(),
  tomtomClient: {
    get: vi.fn(),
    defaults: {
      params: { key: "test-api-key" },
      baseURL: "https://api.tomtom.com",
    },
  },
  getEffectiveApiKey: vi.fn().mockReturnValue("test-api-key"),
  API_VERSION: {
    SEARCH: 2,
    GEOCODING: 2,
    ROUTING: 1,
    TRAFFIC: 5,
    MAP: 1,
  },
  ORBIS_API_VERSION: {
    SEARCH: 1,
    GEOCODING: 1,
    ROUTING: 2,
    TRAFFIC: 1,
    MAP: 1,
  },
  getSessionBackend: vi.fn(),
  setSessionContext: vi.fn(),
  runWithSessionContext: vi.fn(),
}));
type MockCallArgs = [string, { params?: Record<string, unknown> }?];
const mockedTomtomClient = tomtomClient as unknown as {
  get: {
    mock: { calls: Array<MockCallArgs> };
    mockResolvedValue: (v: unknown) => void;
    mockImplementation: (fn: (url: string) => unknown) => void;
    mockReset: () => void;
    mockClear: () => void;
  };
};

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("Dynamic Map Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedTomtomClient.get.mockReset();

    // Default: tile requests return a valid PNG buffer, copyright/style return JSON
    mockedTomtomClient.get.mockImplementation((url: string) => {
      if (url.includes("copyrights/caption")) {
        return Promise.resolve({
          status: 200,
          data: { copyrightsCaption: "©TomTom" },
        });
      }
      // Tile requests — return arraybuffer
      if (url.includes("/tile/")) {
        return Promise.resolve({
          status: 200,
          data: MOCK_PNG_BUFFER,
        });
      }
      return Promise.reject(new Error("Unmocked API call: " + url));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("renderDynamicMap", () => {
    it("should render a map with markers successfully", async () => {
      const options = {
        markers: [{ lat: 52.374, lon: 4.8897, label: "Amsterdam", color: "#ff0000" }],
        width: 600,
        height: 400,
      };

      const result = await renderDynamicMap(options);

      expect(result).toMatchObject({
        contentType: "image/png",
        width: 600,
        height: 400,
      });
      expect(result.base64).toBeDefined();
      expect(result.mapState).toBeDefined();
      expect(result.mapState?.sources.markers).toBeDefined();
    });

    it("should handle route planning mode with routePlans", async () => {
      const routingModule = await import("../routing/routingService");
      const mockRouteResponse = {
        routes: [
          {
            summary: {
              lengthInMeters: 1000,
              travelTimeInSeconds: 300,
              trafficDelayInSeconds: 0,
              departureTime: "2025-01-01T10:00:00Z",
              arrivalTime: "2025-01-01T10:05:00Z",
            },
            legs: [
              {
                points: [
                  { latitude: 52.374, longitude: 4.8897 },
                  { latitude: 50.8503, longitude: 4.3517 },
                  { latitude: 48.8566, longitude: 2.3522 },
                ],
              },
            ],
          },
        ],
      };
      vi.spyOn(routingModule, "getMultiWaypointRoute").mockResolvedValue(mockRouteResponse);

      const options = {
        routePlans: [
          {
            origin: { lat: 52.374, lon: 4.8897 },
            destination: { lat: 48.8566, lon: 2.3522 },
            waypoints: [{ lat: 50.8503, lon: 4.3517 }],
            label: "Amsterdam to Paris",
          },
        ],
      };

      const result = await renderDynamicMap(options);

      expect(result.contentType).toBe("image/png");
      expect(result.base64).toBeDefined();
      expect(routingModule.getMultiWaypointRoute).toHaveBeenCalled();
    });

    it("should still render when tile API fails (graceful fallback)", async () => {
      mockedTomtomClient.get.mockImplementation((url: string) => {
        if (url.includes("copyrights/caption")) {
          return Promise.resolve({
            status: 200,
            data: { copyrightsCaption: "©TomTom" },
          });
        }
        // All tile requests fail
        return Promise.reject(new Error("Connection refused"));
      });

      const options = {
        markers: [{ lat: 52.374, lon: 4.8897 }],
      };

      // Service gracefully handles tile failures (uses blank tiles)
      const result = await renderDynamicMap(options);
      expect(result.contentType).toBe("image/png");
      expect(result.base64).toBeDefined();
    });

    it("should throw error when no content is provided", async () => {
      const options = {};

      await expect(renderDynamicMap(options)).rejects.toThrow("Map requires content to display");
    });

    it("should handle TomTom API error responses gracefully", async () => {
      mockedTomtomClient.get.mockImplementation((url: string) => {
        if (url.includes("copyrights/caption")) {
          return Promise.reject(new Error("Unauthorized"));
        }
        // Tile requests also fail
        return Promise.reject(new Error("Unauthorized"));
      });

      const options = {
        markers: [{ lat: 52.374, lon: 4.8897 }],
      };

      // Service still renders with blank tiles and fallback copyright
      const result = await renderDynamicMap(options);
      expect(result.contentType).toBe("image/png");
      expect(result.base64).toBeDefined();
    });

    it("should apply default options", async () => {
      const options = {
        markers: [{ lat: 52.374, lon: 4.8897 }],
      };

      const result = await renderDynamicMap(options);

      expect(result.width).toBe(600); // Default
      expect(result.height).toBe(400); // Default
      expect(result.contentType).toBe("image/png");
    });

    it("should cap dimensions at maximum values", async () => {
      const options = {
        markers: [{ lat: 52.374, lon: 4.8897 }],
        width: 2000,
        height: 2000,
      };

      const result = await renderDynamicMap(options);

      expect(result.width).toBe(800); // MAX_WIDTH
      expect(result.height).toBe(600); // MAX_HEIGHT
    });

    it("should handle intelligent route calculation with per-plan options", async () => {
      const mockRouteResponse = {
        routes: [
          {
            summary: {
              lengthInMeters: 1000,
              travelTimeInSeconds: 300,
              trafficDelayInSeconds: 0,
              departureTime: "2025-01-01T10:00:00Z",
              arrivalTime: "2025-01-01T10:05:00Z",
            },
            legs: [
              {
                points: [
                  { latitude: 52.374, longitude: 4.8897 },
                  { latitude: 52.368, longitude: 4.9 },
                  { latitude: 52.365, longitude: 4.895 },
                ],
              },
            ],
          },
        ],
      };

      const routingModule = await import("../routing/routingService");
      vi.spyOn(routingModule, "getRoute").mockResolvedValue(mockRouteResponse);

      const origin = { lat: 52.374, lon: 4.8897 };
      const destination = { lat: 52.365, lon: 4.895 };
      const options = {
        routePlans: [
          {
            origin,
            destination,
            routeType: "fastest" as const,
            travelMode: "car" as const,
          },
        ],
      };

      const result = await renderDynamicMap(options);

      expect(result.contentType).toBe("image/png");
      expect(result.base64).toBeDefined();
      expect(routingModule.getRoute).toHaveBeenCalledWith(
        origin,
        destination,
        expect.objectContaining({
          routeType: "fastest",
          travelMode: "car",
          traffic: false,
          instructionsType: "text",
          sectionType: [],
          computeTravelTimeFor: "all",
        })
      );
    });
  });

  describe("Environment configuration", () => {
    it("should work with custom API key from environment", async () => {
      process.env.TOMTOM_API_KEY = "custom-api-key";

      const options = {
        markers: [{ lat: 52.374, lon: 4.8897 }],
      };

      const result = await renderDynamicMap(options);

      expect(result.contentType).toBe("image/png");
      expect(result.base64).toBeDefined();
      expect(mockedTomtomClient.get).toHaveBeenCalled();
    });

    it("should throw error when only center and zoom are provided without content", async () => {
      const options = {
        center: { lat: 37.7749, lon: -122.4194 },
        zoom: 12,
        width: 800,
        height: 600,
      };

      await expect(renderDynamicMap(options)).rejects.toThrow("Map requires content to display");
    });

    it("should accept bbox with markers to constrain map bounds", async () => {
      const options = {
        bbox: [-122.5, 37.7, -122.3, 37.8] as BBox,
        markers: [{ lat: 37.75, lon: -122.4 }],
        width: 800,
        height: 600,
      };

      const result = await renderDynamicMap(options);
      expect(result.contentType).toBe("image/png");
      expect(result.base64).toBeDefined();
    });

    it("should use Genesis tile API when use_orbis is false", async () => {
      const options = {
        markers: [{ lat: 52.374, lon: 4.8897 }],
        use_orbis: false,
      } as unknown as DynamicMapOptions;

      const result = await renderDynamicMap(options);

      expect(result.contentType).toBe("image/png");
      expect(result.base64).toBeDefined();

      // Should fetch Genesis tiles
      const genesisTileCall = mockedTomtomClient.get.mock.calls.find(
        (call: [string, ...unknown[]]) => call[0].includes("map/1/tile/basic/main")
      );
      expect(genesisTileCall).toBeDefined();
    });

    it("should use Orbis tile API when use_orbis is true", async () => {
      const options = {
        markers: [{ lat: 52.374, lon: 4.8897 }],
        use_orbis: true,
      } as unknown as DynamicMapOptions;

      const result = await renderDynamicMap(options);

      expect(result.contentType).toBe("image/png");
      expect(result.base64).toBeDefined();

      // Should fetch Orbis tiles
      const orbisTileCall = mockedTomtomClient.get.mock.calls.find((call: [string, ...unknown[]]) =>
        call[0].includes("maps/orbis/map-display/tile")
      );
      expect(orbisTileCall).toBeDefined();
    });
  });

  describe("Copyright Attribution", () => {
    it("should fetch TomTom Maps copyright caption successfully", async () => {
      mockedTomtomClient.get.mockImplementation((url: string) => {
        if (url.includes("copyrights/caption")) {
          return Promise.resolve({
            status: 200,
            data: { copyrightsCaption: "©TomTom" },
          });
        }
        if (url.includes("/tile/")) {
          return Promise.resolve({ status: 200, data: MOCK_PNG_BUFFER });
        }
        return Promise.reject(new Error("Unmocked API call"));
      });

      const options = {
        markers: [{ lat: 52.374, lon: 4.8897 }],
        use_orbis: false,
      };

      const result = await renderDynamicMap(options);

      expect(result).toBeDefined();
      expect(result.base64).toBeDefined();

      const copyrightCall = mockedTomtomClient.get.mock.calls.find((call: [string, ...unknown[]]) =>
        call[0].includes("map/2/copyrights/caption.json")
      );
      expect(copyrightCall).toBeDefined();
    });

    it("should fetch TomTom Orbis Maps copyright caption successfully", async () => {
      mockedTomtomClient.get.mockImplementation((url: string) => {
        if (url.includes("copyrights/caption")) {
          return Promise.resolve({
            status: 200,
            data: { copyrightsCaption: "©TomTom, ©OpenStreetMap" },
          });
        }
        if (url.includes("/tile/")) {
          return Promise.resolve({ status: 200, data: MOCK_PNG_BUFFER });
        }
        return Promise.reject(new Error("Unmocked API call"));
      });

      const options = {
        markers: [{ lat: 52.374, lon: 4.8897 }],
        use_orbis: true,
      };

      const result = await renderDynamicMap(options);

      expect(result).toBeDefined();
      expect(result.base64).toBeDefined();

      const copyrightCall = mockedTomtomClient.get.mock.calls.find((call: MockCallArgs) =>
        call[0].includes("maps/orbis/copyrights/caption.json")
      );
      expect(copyrightCall).toBeDefined();
      expect(copyrightCall![1]?.params?.apiVersion).toBe(1);
    });

    it("should use fallback copyright text when API call fails", async () => {
      mockedTomtomClient.get.mockImplementation((url: string) => {
        if (url.includes("copyrights/caption")) {
          return Promise.reject(new Error("Copyright API unavailable"));
        }
        if (url.includes("/tile/")) {
          return Promise.resolve({ status: 200, data: MOCK_PNG_BUFFER });
        }
        return Promise.reject(new Error("Unmocked API call"));
      });

      const options = {
        markers: [{ lat: 52.374, lon: 4.8897 }],
        use_orbis: false,
      };

      const result = await renderDynamicMap(options);

      expect(result).toBeDefined();
      expect(result.base64).toBeDefined();
    });

    it("should call different copyright endpoints for Genesis vs Orbis", async () => {
      mockedTomtomClient.get.mockImplementation((url: string) => {
        if (url.includes("copyrights/caption")) {
          return Promise.resolve({
            status: 200,
            data: { copyrightsCaption: "©TomTom" },
          });
        }
        if (url.includes("/tile/")) {
          return Promise.resolve({ status: 200, data: MOCK_PNG_BUFFER });
        }
        return Promise.reject(new Error("Unmocked API call"));
      });

      // Genesis
      await renderDynamicMap({ markers: [{ lat: 52.374, lon: 4.8897 }], use_orbis: false });

      const genesisCopyrightCall = mockedTomtomClient.get.mock.calls.find((call: MockCallArgs) =>
        call[0].includes("map/2/copyrights/caption.json")
      );
      expect(genesisCopyrightCall).toBeDefined();

      // Orbis
      mockedTomtomClient.get.mockClear();
      mockedTomtomClient.get.mockImplementation((url: string) => {
        if (url.includes("copyrights/caption")) {
          return Promise.resolve({
            status: 200,
            data: { copyrightsCaption: "©TomTom, ©OpenStreetMap" },
          });
        }
        if (url.includes("/tile/")) {
          return Promise.resolve({ status: 200, data: MOCK_PNG_BUFFER });
        }
        return Promise.reject(new Error("Unmocked API call"));
      });

      await renderDynamicMap({ markers: [{ lat: 52.374, lon: 4.8897 }], use_orbis: true });

      const orbisCopyrightCall = mockedTomtomClient.get.mock.calls.find((call: MockCallArgs) =>
        call[0].includes("maps/orbis/copyrights/caption.json")
      );
      expect(orbisCopyrightCall).toBeDefined();
      expect(orbisCopyrightCall![1]?.params?.apiVersion).toBe(1);
    });
  });
});
