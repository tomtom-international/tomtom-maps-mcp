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

import { describe, it, expect } from "vitest";
import { tomtomDynamicMapSchema } from "./dynamicMapSchema";
import { z } from "zod";

// Create Zod schema for testing
const dynamicMapSchemaObject = z.object(tomtomDynamicMapSchema);

describe("Dynamic Map Schema", () => {
  describe("Valid inputs", () => {
    it("should validate minimal marker request", () => {
      const validInput = {
        markers: [
          { lat: 52.3740, lon: 4.8897, label: "Amsterdam" }
        ]
      };
      
      expect(() => dynamicMapSchemaObject.parse(validInput)).not.toThrow();
    });

    it("should validate route planning request", () => {
      const validInput = {
        origin: { lat: 52.3740, lon: 4.8897 },
        destination: { lat: 48.8566, lon: 2.3522 },
        waypoints: [
          { lat: 50.8503, lon: 4.3517 } // Brussels
        ],
        showLabels: true
      };
      
      expect(() => dynamicMapSchemaObject.parse(validInput)).not.toThrow();
    });

    it("should validate complex route with traffic data", () => {
      const validInput = {
        routes: [
          {
            points: [
              { lat: 52.3740, lon: 4.8897 },
              { lat: 52.3680, lon: 4.9000 }
            ],
            name: "Amsterdam Route",
            color: "#0066cc"
          }
        ],
        routeData: {
          lengthInMeters: 15000,
          travelTimeInSeconds: 1200,
          trafficDelayInSeconds: 300
        },
        width: 1024,
        height: 768,
        showLabels: true,
        routeInfoDetail: "detailed"
      };
      
      expect(() => dynamicMapSchemaObject.parse(validInput)).not.toThrow();
    });

    it("should validate bbox positioning", () => {
      const validInput = {
        bbox: [4.85, 52.35, 4.95, 52.40], // Amsterdam area
        markers: [
          { lat: 52.3740, lon: 4.8897 }
        ]
      };
      
      expect(() => dynamicMapSchemaObject.parse(validInput)).not.toThrow();
    });

    it("should validate multiple coordinate formats", () => {
      const validInput = {
        route: [
          { lat: 52.3740, lon: 4.8897 }, // Standard format
          [52.3680, 4.9000], // Array format
          { coordinates: [52.3650, 4.8950] } // Coordinates object format
        ]
      };
      
      expect(() => dynamicMapSchemaObject.parse(validInput)).not.toThrow();
    });
  });

  describe("Optional parameters", () => {
    it("should accept all optional parameters as undefined", () => {
      const minimalInput = {
        markers: [{ lat: 0, lon: 0 }]
      };
      
      const result = dynamicMapSchemaObject.parse(minimalInput);
      expect(result.center).toBeUndefined();
      expect(result.zoom).toBeUndefined();
      expect(result.width).toBeUndefined();
      expect(result.height).toBeUndefined();
      expect(result.showLabels).toBeUndefined();

    });

    it("should validate all route info detail levels", () => {
      const levels = ["basic", "compact", "detailed", "distance-time"];
      
      levels.forEach(level => {
        const input = {
          markers: [{ lat: 0, lon: 0 }],
          routeInfoDetail: level
        };
        
        expect(() => dynamicMapSchemaObject.parse(input)).not.toThrow();
      });
    });
  });

  describe("Validation bounds", () => {
    it("should enforce zoom level bounds", () => {
      const invalidZoomLow = {
        markers: [{ lat: 0, lon: 0 }],
        zoom: -1
      };
      
      const invalidZoomHigh = {
        markers: [{ lat: 0, lon: 0 }],
        zoom: 25
      };
      
      expect(() => dynamicMapSchemaObject.parse(invalidZoomLow)).toThrow();
      expect(() => dynamicMapSchemaObject.parse(invalidZoomHigh)).toThrow();
    });

    it("should enforce dimension bounds", () => {
      const invalidDimensions = {
        markers: [{ lat: 0, lon: 0 }],
        width: 50,  // Too small
        height: 3000 // Too large
      };
      
      expect(() => dynamicMapSchemaObject.parse(invalidDimensions)).toThrow();
    });

    it("should validate bbox array length", () => {
      const invalidBbox = {
        markers: [{ lat: 0, lon: 0 }],
        bbox: [4.85, 52.35, 4.95] // Missing north coordinate
      };
      
      expect(() => dynamicMapSchemaObject.parse(invalidBbox)).toThrow();
    });
  });

  describe("Route planning validation", () => {
    it("should allow origin without destination (manual routing)", () => {
      const manualRoute = {
        origin: { lat: 52.3740, lon: 4.8897 }
        // No destination - user can provide manual routes or markers
      };
      
      // Schema validation should pass - route planning is optional
      expect(() => dynamicMapSchemaObject.parse(manualRoute)).not.toThrow();
    });
  });

  describe("Array formats", () => {
    it("should validate multiple routes", () => {
      const validInput = {
        routes: [
          {
            points: [
              { lat: 52.3740, lon: 4.8897 },
              { lat: 52.3680, lon: 4.9000 }
            ],
            name: "Route 1"
          },
          {
            points: [
              { lat: 48.8566, lon: 2.3522 },
              { lat: 48.8606, lon: 2.3376 }
            ],
            name: "Route 2"
          }
        ],
        routeData: [
          { lengthInMeters: 1000, travelTimeInSeconds: 300 },
          { lengthInMeters: 2000, travelTimeInSeconds: 600 }
        ]
      };
      
      expect(() => dynamicMapSchemaObject.parse(validInput)).not.toThrow();
    });

    it("should validate single route data for multiple routes", () => {
      const validInput = {
        routes: [
          { points: [{ lat: 52.3740, lon: 4.8897 }, { lat: 52.3680, lon: 4.9000 }] }
        ],
        routeData: { lengthInMeters: 1000, travelTimeInSeconds: 300 } // Single object for multiple routes
      };
      
      expect(() => dynamicMapSchemaObject.parse(validInput)).not.toThrow();
    });
  });
});
