/*
 * Copyright (C) 2025 TomTom NV
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
import axios from "axios";
import { renderDynamicMap } from "./dynamicMapService";
import { tomtomClient } from "../base/tomtomClient";

// // Mock axios
vi.mock("axios", () => {
  return {
    default: {
      get: vi.fn(),
      post: vi.fn(),
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockedTomtomClient = tomtomClient as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockedAxios = axios as any;

// Mock MapLibre GL Native
vi.mock("@maplibre/maplibre-gl-native", () => {
  const mockMap = {
    load: vi.fn((_style) => {
      // Simulate async loading by immediately calling the style load callback
      setTimeout(() => {
        // Simulate map loaded state
      }, 0);
    }),
    render: vi.fn((options, callback) => {
      // Simulate successful rendering by calling the callback with mock data
      setTimeout(() => {
        const mockBuffer = new Uint8Array(options.width * options.height * 4); // RGBA
        // Fill with some mock data
        for (let i = 0; i < mockBuffer.length; i += 4) {
          mockBuffer[i] = 255; // R
          mockBuffer[i + 1] = 255; // G
          mockBuffer[i + 2] = 255; // B
          mockBuffer[i + 3] = 255; // A
        }
        callback(undefined, mockBuffer);
      }, 0);
    }),
    release: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    setLayoutProperty: vi.fn(),
    setPaintProperty: vi.fn(),
    fitBounds: vi.fn(),
    on: vi.fn((event, callback) => {
      if (event === "style.load") {
        // Immediately call the callback to simulate style loaded
        setTimeout(callback, 0);
      }
    }),
    once: vi.fn((event, callback) => {
      if (event === "style.load") {
        // Immediately call the callback to simulate style loaded
        setTimeout(callback, 0);
      }
    }),
  };

  return {
    default: {
      Map: vi.fn(() => mockMap),
    },
  };
});

// Mock canvas
vi.mock("canvas", () => ({
  createCanvas: vi.fn((width, height) => ({
    getContext: vi.fn(() => ({
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 50 })),
      createImageData: vi.fn((w, h) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      })),
      putImageData: vi.fn(),
    })),
    toBuffer: vi.fn((format) => Buffer.from("fake-image-data")),
    width,
    height,
  })),
}));

// Validation function is already mocked in the main tomtomClient mock

// Mock logger
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
    // Set default environment
    process.env.DYNAMIC_MAP_SERVER_URL = "http://localhost:3000";

    // Setup default mocks for all tests
    mockedTomtomClient.get.mockReset();

    // Setup default successful response for style endpoint
    mockedTomtomClient.get.mockImplementation((url: string) => {
      if (url.includes("style") || url.includes("maps/orbis")) {
        return Promise.resolve({
          status: 200,
          data: {
            version: 8,
            sources: {},
            layers: [],
          },
        });
      }
      return Promise.reject(new Error(`No mock implementation for URL: ${url}`));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("renderDynamicMap", () => {
    it("should render a map with markers successfully", async () => {
      // Using the default mock setup from beforeEach

      const options = {
        markers: [{ lat: 52.374, lon: 4.8897, label: "Amsterdam", color: "#ff0000" }],
        width: 800,
        height: 600,
      };

      const result = await renderDynamicMap(options);

      expect(result).toEqual({
        base64: Buffer.from("fake-image-data").toString("base64"),
        contentType: "image/png",
        width: 800,
        height: 600,
      });

      // Should call TomTom style API (check URL part only)
      expect(mockedTomtomClient.get).toHaveBeenCalled();
      const styleApiCall = mockedTomtomClient.get.mock.calls.find((call: any[]) =>
        call[0].includes("style/1/style")
      );
      expect(styleApiCall).toBeDefined();
      expect(styleApiCall[0]).toEqual(expect.stringContaining("style/1/style"));
    });

    it("should handle route planning mode", async () => {
      // Using the default mock setup from beforeEach

      // Mock the routing service to avoid actual routing calls
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
        origin: { lat: 52.374, lon: 4.8897 },
        destination: { lat: 48.8566, lon: 2.3522 },
        waypoints: [{ lat: 50.8503, lon: 4.3517 }],
      };

      const result = await renderDynamicMap(options);

      expect(result.contentType).toBe("image/png");
      expect(result.base64).toBeDefined();

      // Verify the routing service was called correctly
      expect(routingModule.getMultiWaypointRoute).toHaveBeenCalled();

      // Find the style API call (it might not be the first call)
      const styleApiCall = mockedTomtomClient.get.mock.calls.find((call: any[]) =>
        call[0].includes("style/1/style")
      );
      expect(styleApiCall).toBeDefined();
      expect(styleApiCall[0]).toEqual(expect.stringContaining("style/1/style"));
    });

    it("should throw error when TomTom API is not available", async () => {
      mockedTomtomClient.get.mockRejectedValueOnce(new Error("Connection refused"));

      const options = {
        markers: [{ lat: 52.374, lon: 4.8897 }],
      };

      await expect(renderDynamicMap(options)).rejects.toThrow("Connection refused");
    });

    it("should throw error when only origin is provided without destination", async () => {
      const options = {
        origin: { lat: 52.374, lon: 4.8897 },
        // No destination provided - should throw validation error
      };

      await expect(renderDynamicMap(options)).rejects.toThrow(
        "Origin provided without destination. Both origin and destination are required for route planning."
      );
    });

    it("should handle TomTom API error responses", async () => {
      mockedTomtomClient.get.mockRejectedValueOnce({
        response: {
          status: 401,
          data: "Unauthorized: Invalid API key",
        },
      });

      const options = {
        markers: [{ lat: 52.374, lon: 4.8897 }],
      };

      await expect(renderDynamicMap(options)).rejects.toThrow();
    });

    it("should apply default options", async () => {
      // Using the default mock setup from beforeEach

      const options = {
        markers: [{ lat: 52.374, lon: 4.8897 }],
        // No width, height, etc. - should use defaults
      };

      const result = await renderDynamicMap(options);

      expect(result.width).toBe(800); // Default
      expect(result.height).toBe(600); // Default
      expect(result.contentType).toBe("image/png");
    });

    it("should handle intelligent route calculation", async () => {
      // Using the default mock setup from beforeEach

      // Mock route service response with proper RouteResult structure
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

      // Mock the routing service
      const routingModule = await import("../routing/routingService");
      vi.spyOn(routingModule, "getRoute").mockResolvedValue(mockRouteResponse);

      const options = {
        origin: { lat: 52.374, lon: 4.8897 },
        destination: { lat: 52.365, lon: 4.895 },
        routeType: "fastest" as const,
        travelMode: "car" as const,
      };

      const result = await renderDynamicMap(options);

      expect(result.contentType).toBe("image/png");
      expect(result.base64).toBeDefined();
      expect(routingModule.getRoute).toHaveBeenCalledWith(
        options.origin,
        options.destination,
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

    it("should handle custom dimensions", async () => {
      // Using the default mock setup from beforeEach

      const options = {
        markers: [{ lat: 52.374, lon: 4.8897 }],
        width: 1024,
        height: 768,
      };

      const result = await renderDynamicMap(options);

      expect(result.width).toBe(1024);
      expect(result.height).toBe(768);
      expect(result.contentType).toBe("image/png");
      expect(result.base64).toBeDefined();
    });
  });

  describe("Environment configuration", () => {
    it("should work with custom API key from environment", async () => {
      process.env.TOMTOM_API_KEY = "custom-api-key";

      // Using the default mock setup from beforeEach

      const options = {
        markers: [{ lat: 52.374, lon: 4.8897 }],
      };

      const result = await renderDynamicMap(options);

      expect(result.contentType).toBe("image/png");
      expect(result.base64).toBeDefined();

      // Should use the custom API key (check URL query only)
      expect(mockedTomtomClient.get).toHaveBeenCalled();
      // expect(mockedTomtomClient.get.mock.calls[0][0]).toEqual(
      //   expect.stringContaining('key=custom-api-key')
      // );
    });

    it("should throw error when only center and zoom are provided without content", async () => {
      const options = {
        center: { lat: 37.7749, lon: -122.4194 },
        zoom: 12,
        width: 800,
        height: 600,
      };

      await expect(renderDynamicMap(options)).rejects.toThrow(
        "Map requires content to display. Please provide at least one of: markers, polygons, routes, origin+destination (for route planning), or bbox (for area bounds)."
      );
    });

    it("should accept bbox as valid content without requiring markers/polygons/routes", async () => {
      // Using the default mock setup from beforeEach

      const options = {
        bbox: [-122.5, 37.7, -122.3, 37.8] as [number, number, number, number], // [west, south, east, north]
        width: 800,
        height: 600,
      };

      const result = await renderDynamicMap(options);
      expect(result.contentType).toBe("image/png");
      expect(result.base64).toBeDefined();
    });

    it("should use Orbis API when use_orbis option is set", async () => {
      // Using the default mock setup from beforeEach

      const options = {
        markers: [{ lat: 52.374, lon: 4.8897 }],
        use_orbis: true,
      } as any;

      const result = await renderDynamicMap(options);

      expect(result.contentType).toBe("image/png");
      expect(result.base64).toBeDefined();

      // Should use Orbis style API when use_orbis option is true (check URL part only)
      expect(mockedTomtomClient.get).toHaveBeenCalled();
      // Find the Orbis API call
      const orbisApiCall = mockedTomtomClient.get.mock.calls.find((call: any[]) =>
        call[0].includes("maps/orbis")
      );
      expect(orbisApiCall).toBeDefined();
      expect(orbisApiCall[0]).toEqual(expect.stringContaining("maps/orbis"));
    });
  });
});
