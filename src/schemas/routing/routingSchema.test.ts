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

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  tomtomReachableRangeSchema,
  tomtomRoutingSchema,
  tomtomWaypointRoutingSchema,
} from "./routingSchema";

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
      routeType: "fastest",
      travelMode: "car",
      traffic: true,
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
  const schema = z.object(tomtomReachableRangeSchema);
  it("should parse valid reachable range input with origin and timeBudgetInSec", () => {
    const input = {
      origin: { lat: 1, lon: 2 },
      timeBudgetInSec: 900,
    };
    expect(schema.parse(input)).toMatchObject(input);
  });

  it("should parse valid reachable range input with origin and distanceBudgetInMeters", () => {
    const input = {
      origin: { lat: 1, lon: 2 },
      distanceBudgetInMeters: 10000,
    };
    expect(schema.parse(input)).toMatchObject(input);
  });

  it("should fail if origin is missing", () => {
    expect(() => schema.parse({ timeBudgetInSec: 900 })).toThrow();
  });
});
