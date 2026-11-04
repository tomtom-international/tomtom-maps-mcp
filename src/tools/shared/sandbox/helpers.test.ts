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

import * as turf from "@turf/turf";
import { describe, expect, it } from "vitest";
import { positionAlong, resolveStretches } from "../inputs/route-stretch";
import { HELPERS_SOURCE } from "./helpers";

const { place, route, incident } = new Function("turf", HELPERS_SOURCE)(turf);

const at = (day: number, hour: number, minute = 0) => ({
  year: 2026,
  month: 11,
  day,
  hour,
  minute,
});
const cafe = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [5.11, 52.09] },
  properties: {
    poi: {
      name: "Esso Express",
      brands: ["Aisuo", "埃索", "Esso"],
      categories: ["CAFE"],
      openingHours: {
        timeRanges: [
          { start: at(1, 0), end: at(1, 2) },
          { start: at(1, 7, 30), end: at(1, 23) },
        ],
      },
    },
    chargingPark: { connectors: [{ connector: { type: "Chademo", ratedPowerKW: 50 }, count: 2 }] },
  },
};

describe("place helpers", () => {
  it("reads opening hours at a local time, and unknown hours as undefined", () => {
    expect(place.openAt(cafe, "2026-11-01T22:59")).toBe(true);
    expect(place.openAt(cafe, "2026-11-01T23:00")).toBe(false);
    expect(place.openAt({ properties: {} }, "2026-11-01T12:00")).toBeUndefined();
  });

  it("takes the first opening of a day, not a night carried over at midnight", () => {
    expect(place.opensOn(cafe, "2026-11-01")).toBe("07:30");
    expect(place.opensOn(cafe, "2026-11-02")).toBeUndefined();
  });

  it("flattens connectors, and picks the brand the name uses", () => {
    expect(place.connectors(cafe)).toEqual([
      { type: "Chademo", ratedPowerKW: 50, currentType: undefined, count: 2 },
    ]);
    expect(place.maxPowerKW(cafe)).toBe(50);
    expect(place.brand(cafe)).toBe("Esso");
  });

  it("rejects a time it cannot read rather than answering false", () => {
    expect(() => place.openAt(cafe, "Saturday night")).toThrow(/YYYY-MM-DDTHH:MM/);
  });
});

describe("route helpers", () => {
  const drive = {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [4.9, 52.37],
        [4.95, 52.37],
        [5.0, 52.37],
      ],
    },
    properties: {
      sections: { lowEmissionZone: [{ startPointIndex: 1, endPointIndex: 2 }] },
      progress: [
        { pointIndex: 0, distanceInMeters: 0, travelTimeInSeconds: 0 },
        { pointIndex: 2, distanceInMeters: 6800, travelTimeInSeconds: 600 },
      ],
    },
  };

  it("measures sections along the line, with their drive times", () => {
    const [zone] = route.sections(drive, "lowEmissionZone");
    expect(zone.startMeters).toBeCloseTo(3400, -2);
    expect(zone.lengthMeters).toBeCloseTo(3400, -2);
    expect(zone.startSeconds).toBeCloseTo(300, 0);
    expect(zone.endSeconds).toBe(600);
  });

  it("locates a point along the route, with the time to reach it", () => {
    const located = route.locate(drive, [4.95, 52.371]);
    expect(located.meters).toBeCloseTo(3400, -2);
    expect(located.offRouteMeters).toBeCloseTo(111, -1);
    expect(located.seconds).toBeGreaterThan(0);
  });

  it("measures by the distances the route reports, as a place's alongRoute does", () => {
    const longer = {
      ...drive,
      properties: {
        ...drive.properties,
        summary: { lengthInMeters: 10_000, travelTimeInSeconds: 600 },
        progress: [
          { pointIndex: 0, distanceInMeters: 0, travelTimeInSeconds: 0 },
          { pointIndex: 2, distanceInMeters: 10_000, travelTimeInSeconds: 600 },
        ],
      },
    };
    const point = [4.95, 52.371];
    const alongRoute = positionAlong(resolveStretches(longer as never), point);

    expect(route.locate(longer, point).meters).toBeCloseTo(alongRoute?.meters ?? Number.NaN, 0);
    expect(route.locate(longer, point).meters).toBeCloseTo(5000, -2);
    expect(route.pointAt(longer, 5000)[0]).toBeCloseTo(4.95, 4);
  });

  it("measures a line without progress by its own length, with no times", () => {
    const line = { type: "Feature", geometry: drive.geometry, properties: {} };
    const located = route.locate(line, [4.95, 52.371]);
    expect(located.meters).toBeCloseTo(3400, -2);
    expect(located.seconds).toBeUndefined();
  });
});

describe("incident helpers", () => {
  it("lists event descriptions and measures to the incident's line", () => {
    const closure = {
      geometry: {
        type: "LineString",
        coordinates: [
          [4.9, 52.37],
          [4.91, 52.37],
        ],
      },
      properties: { events: [{ description: "Closed", code: 401 }] },
    };
    expect(incident.events(closure)).toEqual(["Closed"]);
    expect(incident.distanceTo(closure, [4.905, 52.37])).toBeCloseTo(0, 0);
  });
});
