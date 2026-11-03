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

import type { Places, Route } from "@tomtom-org/maps-sdk/core";
import * as turf from "@turf/turf";
import type { Polygon, Position } from "geojson";
import { describe, expect, it, vi } from "vitest";
import { corridorPieces, MAX_CORRIDOR_REQUESTS, searchCorridor } from "./corridor";
import { resolveStretches } from "./inputs/route-stretch";

/** A winding road east from Amsterdam's longitude, about 140 km, every bend a few hundred metres. */
const coordinates: Position[] = Array.from({ length: 600 }, (_, index) => [
  4 + index * (2 / 599),
  52 + 0.05 * Math.sin(index / 6),
]);
const length = turf.length(turf.lineString(coordinates), { units: "meters" });
const ROUTE = {
  type: "Feature",
  geometry: { type: "LineString", coordinates },
  properties: {
    summary: { lengthInMeters: length, travelTimeInSeconds: length / 25 },
    progress: [
      { pointIndex: 0, distanceInMeters: 0, travelTimeInSeconds: 0 },
      { pointIndex: 599, distanceInMeters: length, travelTimeInSeconds: length / 25 },
    ],
    sections: {},
  },
} as unknown as Route;

const place = (id: string, position: Position): Places["features"][number] =>
  ({
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates: position },
    properties: { type: "POI", address: { freeformAddress: id } },
  }) as Places["features"][number];

const placesOf = (features: Places["features"]): Places =>
  ({ type: "FeatureCollection", features }) as Places;

/** The point `meters` to the left of the road at vertex `index`. */
const beside = (index: number, meters: number): Position => {
  const bearing = turf.bearing(coordinates[index], coordinates[index + 1]);
  return turf.destination(coordinates[index], meters, bearing - 90, { units: "meters" }).geometry
    .coordinates;
};

describe("corridorPieces", () => {
  const stretches = resolveStretches(ROUTE);

  it("draws every polygon within the Search API's 50 vertices", () => {
    for (const meters of [100, 500, 2000]) {
      for (const { polygon } of corridorPieces(stretches, meters)) {
        expect(polygon.coordinates[0].length - 1).toBeLessThanOrEqual(50);
      }
    }
  });

  it("covers the full width either side of every bend", () => {
    const meters = 300;
    const polygons = corridorPieces(stretches, meters).map(({ polygon }) => polygon);
    for (let index = 0; index < coordinates.length - 1; index += 7) {
      for (const side of [meters, -meters]) {
        const point = beside(index, side);
        expect(polygons.some((polygon) => turf.booleanPointInPolygon(point, polygon))).toBe(true);
      }
    }
  });

  it("lists the pieces in driving order", () => {
    const pieces = corridorPieces(stretches, 100);
    expect(pieces.length).toBeGreaterThan(1);
    const starts = pieces.map(({ fromMeters }) => fromMeters);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});

describe("searchCorridor", () => {
  const stretches = resolveStretches(ROUTE);

  it("keeps only places within the width of the road, in driving order, each placed on it", async () => {
    const search = vi.fn(async () =>
      placesOf([
        place("far", beside(300, 900)),
        place("late", beside(500, 100)),
        place("early", beside(20, 200)),
      ])
    );

    const { places, requests } = await searchCorridor(stretches, 500, 10, search);

    expect(requests).toBe(1);
    expect(places.map(({ id }) => id)).toEqual(["early", "late"]);
    expect(places[0].properties.alongRoute.offRouteMeters).toBeCloseTo(200, -1);
    expect(places[0].properties.alongRoute.meters).toBeLessThan(
      places[1].properties.alongRoute.meters
    );
  });

  it("splits a group whose results hit the cap, so the first places along the drive are not missed", async () => {
    const crowded = placesOf(
      Array.from({ length: 100 }, (_, n) => place(`p${n}`, beside(300, 50)))
    );
    const search = vi.fn(async (polygons: Polygon[]) =>
      polygons.length > 1 ? crowded : placesOf([place("one", beside(10, 50))])
    );

    const { places, requests } = await searchCorridor(stretches, 100, 5, search);

    expect(requests).toBeGreaterThan(1);
    expect(search.mock.calls[1][0].length).toBeLessThan(search.mock.calls[0][0].length);
    expect(places[0].id).toBe("one");
  });

  it("reports the stretches it could not search in full, keeping what the capped searches found", async () => {
    const crowded = placesOf(
      Array.from({ length: 100 }, (_, n) => place(`p${n}`, beside(300, 50)))
    );
    const search = vi.fn(async () => crowded);

    const { places, requests, incomplete } = await searchCorridor(stretches, 100, 100, search);

    expect(places).toHaveLength(100);
    expect(requests).toBe(MAX_CORRIDOR_REQUESTS);
    expect(incomplete.length).toBeGreaterThan(0);
    for (const { fromMeters, toMeters } of incomplete) expect(toMeters).toBeGreaterThan(fromMeters);
  });

  it("stops once the stretches searched hold enough places", async () => {
    const search = vi.fn(async () => placesOf([place("near", beside(5, 20))]));

    await searchCorridor(stretches, 100, 1, search);

    expect(search).toHaveBeenCalledTimes(1);
  });
});
