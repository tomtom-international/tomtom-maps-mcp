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
import { z } from "zod";
import {
  tomtomRoutingSchema,
  tomtomWaypointRoutingSchema,
  tomtomReachableRangeSchema,
} from "./routingOrbisSchema";

// Helper to create a Zod object from the schema object
const makeSchema = (schemaObj: any) => z.object(schemaObj);

describe("tomtomRoutingSchema", () => {
  it("should parse valid origin and destination", () => {
    const input = {
      origin: { lat: 37.7749, lon: -122.4194 },
      destination: { lat: 37.7849, lon: -122.4094 },
    };
    const schema = makeSchema(tomtomRoutingSchema);
    expect(schema.parse(input)).toMatchObject(input);
  });

  it("should fail if origin is missing", () => {
    const schema = makeSchema(tomtomRoutingSchema);
    expect(() => schema.parse({ destination: { lat: 0, lon: 0 } })).toThrow();
  });

  it("should fail if destination is missing", () => {
    const schema = makeSchema(tomtomRoutingSchema);
    expect(() => schema.parse({ origin: { lat: 0, lon: 0 } })).toThrow();
  });

  it("should fail if origin is not a coordinate object", () => {
    const schema = makeSchema(tomtomRoutingSchema);
    expect(() => schema.parse({ origin: "foo", destination: { lat: 0, lon: 0 } })).toThrow();
  });

  it("should parse with optional routing options", () => {
    const input = {
      origin: { lat: 1, lon: 2 },
      destination: { lat: 3, lon: 4 },
      routeType: "fast",
      travelMode: "car",
      traffic: "live",
      avoid: ["tollRoads"],
      departAt: "2025-06-24T14:30:00Z",
    };
    const schema = makeSchema(tomtomRoutingSchema);
    expect(schema.parse(input)).toMatchObject(input);
  });
});

describe("tomtomWaypointRoutingSchema", () => {
  it("should parse valid waypoints array (min 2)", () => {
    const input = {
      waypoints: [
        { lat: 1, lon: 2 },
        { lat: 3, lon: 4 },
        { lat: 5, lon: 6 },
      ],
    };
    const schema = makeSchema(tomtomWaypointRoutingSchema);
    expect(schema.parse(input)).toMatchObject(input);
  });

  it("should fail if waypoints has less than 2 items", () => {
    const schema = makeSchema(tomtomWaypointRoutingSchema);
    expect(() => schema.parse({ waypoints: [{ lat: 1, lon: 2 }] })).toThrow();
  });

  it("should fail if a waypoint is not a coordinate", () => {
    const schema = makeSchema(tomtomWaypointRoutingSchema);
    expect(() => schema.parse({ waypoints: [{ lat: 1, lon: 2 }, "foo"] })).toThrow();
  });
});

describe("tomtomReachableRangeSchema", () => {
  it("should parse valid time-based reachable range", () => {
    const input = {
      origin: { lat: 52.374, lon: 4.8897 },
      timeBudgetInSec: 1800,
      travelMode: "car",
    };
    const schema = makeSchema(tomtomReachableRangeSchema);
    expect(schema.parse(input)).toMatchObject(input);
  });

  it("should parse valid distance-based reachable range", () => {
    const input = {
      origin: { lat: 51.5074, lon: -0.1278 },
      distanceBudgetInMeters: 10000,
      travelMode: "car",
    };
    const schema = makeSchema(tomtomReachableRangeSchema);
    expect(schema.parse(input)).toMatchObject(input);
  });

  it("should parse valid energy-based reachable range (EV)", () => {
    const input = {
      origin: { lat: 52.52, lon: 13.405 },
      energyBudgetInkWh: 10,
      travelMode: "car",
      vehicleEngineType: "electric",
    };
    const schema = makeSchema(tomtomReachableRangeSchema);
    expect(schema.parse(input)).toMatchObject(input);
  });

  it("should parse when no budget provided (handler enforces budget requirement)", () => {
    const input = { origin: { lat: 52.374, lon: 4.8897 }, travelMode: "car" };
    const schema = makeSchema(tomtomReachableRangeSchema);
    // The schema itself does not enforce that at least one budget is present;
    // that validation is performed in the handler at runtime. The schema should
    // still parse a valid origin and optional travelMode.
    expect(schema.parse(input)).toMatchObject(input);
  });

  it("should fail for invalid origin", () => {
    const input = { origin: "invalid", timeBudgetInSec: 100 };
    const schema = makeSchema(tomtomReachableRangeSchema);
    expect(() => schema.parse(input)).toThrow();
  });
});
