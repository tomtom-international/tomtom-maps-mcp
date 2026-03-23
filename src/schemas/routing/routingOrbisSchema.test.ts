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

import { describe, it, expect } from "vitest";
import { z, type ZodRawShape } from "zod";
import { tomtomRoutingSchema, tomtomReachableRangeSchema } from "./routingOrbisSchema";

// Helper to create a Zod object from the schema object
const makeSchema = (schemaObj: ZodRawShape) => z.object(schemaObj);

// Coordinates as [longitude, latitude] tuples (GeoJSON convention)
const amsterdam = [-122.4194, 37.7749] as [number, number];
const berlin = [-122.4094, 37.7849] as [number, number];

describe("tomtomRoutingSchema", () => {
  it("should parse valid 2-location route (origin + destination)", () => {
    const input = { locations: [amsterdam, berlin] };
    const schema = makeSchema(tomtomRoutingSchema);
    expect(schema.parse(input)).toMatchObject(input);
  });

  it("should parse valid multi-stop route (3+ locations)", () => {
    const paris = [2.352222, 48.856614] as [number, number];
    const input = { locations: [amsterdam, berlin, paris] };
    const schema = makeSchema(tomtomRoutingSchema);
    expect(schema.parse(input)).toMatchObject(input);
  });

  it("should fail if locations is missing", () => {
    const schema = makeSchema(tomtomRoutingSchema);
    expect(() => schema.parse({})).toThrow();
  });

  it("should fail if locations has fewer than 2 items", () => {
    const schema = makeSchema(tomtomRoutingSchema);
    expect(() => schema.parse({ locations: [amsterdam] })).toThrow();
  });

  it("should fail if a location is not a coordinate tuple", () => {
    const schema = makeSchema(tomtomRoutingSchema);
    expect(() => schema.parse({ locations: ["foo", berlin] })).toThrow();
  });

  it("should parse with optional routing options", () => {
    const input = {
      locations: [amsterdam, berlin],
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

describe("tomtomReachableRangeSchema", () => {
  it("should parse valid time-based reachable range", () => {
    const input = {
      origin: [4.8897, 52.374] as [number, number],
      timeBudgetInSec: 1800,
      travelMode: "car",
    };
    const schema = makeSchema(tomtomReachableRangeSchema);
    expect(schema.parse(input)).toMatchObject(input);
  });

  it("should parse valid distance-based reachable range", () => {
    const input = {
      origin: [-0.1278, 51.5074] as [number, number],
      distanceBudgetInMeters: 10000,
      travelMode: "car",
    };
    const schema = makeSchema(tomtomReachableRangeSchema);
    expect(schema.parse(input)).toMatchObject(input);
  });

  it("should parse valid charge-based reachable range (EV)", () => {
    const input = {
      origin: [13.405, 52.52] as [number, number],
      chargeBudgetPercent: 80,
      travelMode: "car",
    };
    const schema = makeSchema(tomtomReachableRangeSchema);
    expect(schema.parse(input)).toMatchObject(input);
  });

  it("should parse when no budget provided (handler enforces budget requirement)", () => {
    const input = { origin: [4.8897, 52.374] as [number, number], travelMode: "car" };
    const schema = makeSchema(tomtomReachableRangeSchema);
    // The schema itself does not enforce that at least one budget is present;
    // that validation is performed in the handler at runtime.
    expect(schema.parse(input)).toMatchObject(input);
  });

  it("should fail for invalid origin", () => {
    const input = { origin: "invalid", timeBudgetInSec: 100 };
    const schema = makeSchema(tomtomReachableRangeSchema);
    expect(() => schema.parse(input)).toThrow();
  });
});
