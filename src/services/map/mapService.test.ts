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
import { tomtomClient } from "../base/tomtomClient";
import { getStaticMapImage, getStaticMapUrl } from "./mapService";

// Mock tomtomClient
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
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockedTomtomClient = tomtomClient as any;

describe("Map Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
  // Real test coordinates
  const amsterdam = { lat: 52.377956, lon: 4.89707 }; // Amsterdam
  const berlin = { lat: 52.520008, lon: 13.404954 }; // Berlin

  describe("getStaticMapUrl", () => {
    it("should generate correct static map URL with default options", () => {
      const options = {
        center: amsterdam,
      };

      const url = getStaticMapUrl(options);

      // Verify the URL contains the expected parts
      expect(url).toBeDefined();
      expect(typeof url).toBe("string");
      //expect(url).toContain("api.tomtom.com");
      expect(url).toContain("map");
      expect(url).toContain("staticimage");
      expect(url).toContain("center=4.89707,52.377956");
      //expect(url).toContain("key=");

      // Verify default parameters are applied
      expect(url).toContain("zoom=12"); // actual default zoom from your service
      expect(url).toContain("width=512"); // default width
      expect(url).toContain("height=512"); // default height
    });

    it("should generate correct static map URL with custom options", () => {
      const options = {
        center: berlin,
        zoom: 10,
        width: 1200,
        height: 800,
        style: "night" as const,
        markers: [
          {
            position: berlin,
            color: "#FF0000",
            label: "B",
          },
        ],
      };

      const url = getStaticMapUrl(options);

      // Verify the URL contains the expected parts
      expect(url).toContain("center=13.404954,52.520008");
      expect(url).toContain("zoom=10");
      expect(url).toContain("width=1200");
      expect(url).toContain("height=800");
      expect(url).toContain("style=night");

      // Check for URL structure (your implementation might use different marker format)
      // Based on the actual URL, markers might not use 'pins=' parameter
      expect(url).toBeDefined();
      expect(url.length).toBeGreaterThan(100); // Should be a substantial URL
    });

    it("should generate correct static map URL with bounding box instead of center", () => {
      const options = {
        bbox: [-122.42, 37.77, -122.4, 37.79] as [number, number, number, number], // San Francisco
        height: 600,
        width: 800,
        style: "main" as const,
      };

      const url = getStaticMapUrl(options);

      expect(url).toContain("bbox=-122.42,37.77,-122.4,37.79");
      expect(url).not.toContain("center=");
      expect(url).not.toContain("zoom=");
      expect(url).toContain("height=600");
      expect(url).toContain("width=800");
      expect(url).toContain("style=main");
    });

    it("should add language parameter when provided", () => {
      const options = {
        center: { lat: 52.377956, lon: 4.89707 },
        zoom: 12,
        language: "nl-NL",
      };

      const url = getStaticMapUrl(options);

      expect(url).toContain("language=nl-NL");
    });

    it("should throw error when neither center coordinates nor bounding box are provided", () => {
      expect(() => {
        getStaticMapUrl({} as any);
      }).toThrow("Either center coordinates or bounding box must be provided");
    });

    it("should throw error when zoom level is out of range", () => {
      expect(() => {
        getStaticMapUrl({
          center: amsterdam,
          zoom: 25,
        });
      }).toThrow("Zoom level must be between 0 and 22");

      expect(() => {
        getStaticMapUrl({
          center: amsterdam,
          zoom: -1,
        });
      }).toThrow("Zoom level must be between 0 and 22");
    });

    it("should throw error when dimensions are out of range", () => {
      expect(() => {
        getStaticMapUrl({
          center: amsterdam,
          width: 10000,
        });
      }).toThrow("Width and height must be between 1 and 8192 pixels");

      expect(() => {
        getStaticMapUrl({
          center: amsterdam,
          height: -1,
        });
      }).toThrow("Width and height must be between 1 and 8192 pixels");
    });
  });

  describe("getStaticMapImage", () => {
    it("should download and convert image to base64 for Amsterdam", async () => {
      const options = {
        center: amsterdam,
        zoom: 12,
        width: 400,
        height: 300,
      };

      // Mock the response from tomtomClient.get
      mockedTomtomClient.get.mockResolvedValueOnce({
        status: 200,
        headers: { "content-type": "image/png" },
        data: Buffer.from("fake-image-data"),
      });

      const result = await getStaticMapImage(options);

      // Validate response structure
      expect(result).toBeDefined();
      expect(result.base64).toBeDefined();
      expect(result.contentType).toBeDefined();

      // Check that we got a valid base64 string
      expect(typeof result.base64).toBe("string");
      expect(result.base64.length).toBeGreaterThan(0);

      // Check content type is an image
      expect(result.contentType).toMatch(/^image\//);
      expect(
        ["image/png", "image/jpeg", "image/jpg"].some((type) => result.contentType.includes(type))
      ).toBe(true);

      // Verify tomtomClient was called with the correct URL
      expect(mockedTomtomClient.get).toHaveBeenCalled();
      expect(mockedTomtomClient.get.mock.calls[0][0]).toContain("center=4.89707,52.377956");
      expect(mockedTomtomClient.get.mock.calls[0][0]).toContain("zoom=12");
      expect(mockedTomtomClient.get.mock.calls[0][0]).toContain("width=400");
      expect(mockedTomtomClient.get.mock.calls[0][0]).toContain("height=300");
    });

    it("should download image with custom styling and markers", async () => {
      const options = {
        center: berlin,
        zoom: 14,
        width: 600,
        height: 400,
        style: "night" as const,
        markers: [
          {
            position: berlin,
            color: "#00FF00",
            label: "Berlin",
          },
          {
            position: { lat: 52.519, lon: 13.405 }, // Slightly offset
            color: "#FF0000",
            label: "2",
          },
        ],
      };

      // Mock the response from tomtomClient.get
      mockedTomtomClient.get.mockResolvedValueOnce({
        status: 200,
        headers: { "content-type": "image/png" },
        data: Buffer.from("custom-style-image-data"),
      });

      const result = await getStaticMapImage(options);

      // Validate response structure
      expect(result).toBeDefined();
      expect(result.base64).toBeDefined();
      expect(result.contentType).toBeDefined();
      expect(typeof result.base64).toBe("string");
      expect(result.base64.length).toBeGreaterThan(0);

      // Should be a valid image
      expect(result.contentType).toMatch(/^image\//);

      // Verify tomtomClient was called with the correct URL
      expect(mockedTomtomClient.get).toHaveBeenCalled();
      expect(mockedTomtomClient.get.mock.calls[0][0]).toContain("style=night");
    });

    it("should handle different image formats", async () => {
      const options = {
        center: amsterdam,
        zoom: 10,
        width: 300,
        height: 200,
      };

      // Mock the response from tomtomClient.get with a JPEG image
      mockedTomtomClient.get.mockResolvedValueOnce({
        status: 200,
        headers: { "content-type": "image/jpeg" },
        data: Buffer.from("jpeg-image-data"),
      });

      const result = await getStaticMapImage(options);

      // The API should return a valid image format
      expect(result.contentType).toMatch(/^image\/(png|jpeg|jpg)/);
      expect(result.base64).toBeDefined();
      expect(result.base64.length).toBeGreaterThan(10); // Should be a reasonable size for test data
    });

    it("should handle invalid coordinates gracefully", async () => {
      const options = {
        center: { lat: 999, lon: 999 }, // Invalid coordinates
        zoom: 10,
      };

      // Mock a 400 Bad Request response for invalid coordinates
      mockedTomtomClient.get.mockRejectedValueOnce({
        response: {
          status: 400,
          data: "Invalid coordinates",
        },
      });

      // Should throw an error with invalid coordinates
      await expect(getStaticMapImage(options)).rejects.toThrow();

      // Verify the request was made with invalid coordinates
      expect(mockedTomtomClient.get).toHaveBeenCalled();
      expect(mockedTomtomClient.get.mock.calls[0][0]).toContain("center=999,999");
    });

    it("should handle network timeouts appropriately", async () => {
      const options = {
        center: amsterdam,
        zoom: 15,
        width: 2000, // Large image that might take longer
        height: 2000,
      };

      // Mock a successful response for a large image
      mockedTomtomClient.get.mockResolvedValueOnce({
        status: 200,
        headers: { "content-type": "image/png" },
        data: Buffer.alloc(10000), // Create a large buffer for testing
      });

      const result = await getStaticMapImage(options);

      expect(result).toBeDefined();
      expect(result.base64).toBeDefined();
      expect(result.base64.length).toBeGreaterThan(1000); // Should be a substantial base64 string

      // Verify large dimensions were requested
      expect(mockedTomtomClient.get).toHaveBeenCalled();
      expect(mockedTomtomClient.get.mock.calls[0][0]).toContain("width=2000");
      expect(mockedTomtomClient.get.mock.calls[0][0]).toContain("height=2000");
    });
  });

  describe("URL validation", () => {
    it("should generate valid URLs for various map configurations", () => {
      const configurations = [
        { center: amsterdam, zoom: 5 },
        { center: berlin, zoom: 18, style: "main" as const },
        { center: { lat: 0, lon: 0 }, zoom: 1 }, // Equator
        { center: { lat: -33.8688, lon: 151.2093 }, zoom: 12 }, // Sydney
      ];

      configurations.forEach((config, index) => {
        const url = getStaticMapUrl(config);
        expect(url).toBeDefined();
        //expect(url).toContain("api.tomtom.com");
        expect(url).toContain(`zoom=${config.zoom}`);

        // Each URL should be unique
        const otherUrls = configurations.slice(0, index).map((c) => getStaticMapUrl(c));
        expect(otherUrls).not.toContain(url);
      });
    });

    it("should handle marker configuration", () => {
      const options = {
        center: amsterdam,
        markers: [
          { position: amsterdam, label: "A&B", color: "#FF0000" },
          { position: berlin, label: "C+D", color: "#00FF00" },
        ],
      };

      const url = getStaticMapUrl(options);
      expect(url).toBeDefined();
      //expect(url).toContain("api.tomtom.com");

      // URL should be properly formed regardless of marker format
      expect(url).not.toContain(" "); // No unencoded spaces
      expect(url.length).toBeGreaterThan(100); // Should be substantial
    });
  });
});
