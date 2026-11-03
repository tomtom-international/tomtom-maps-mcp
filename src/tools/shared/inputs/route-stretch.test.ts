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

import type { Route } from "@tomtom-org/maps-sdk/core";
import { describe, expect, it } from "vitest";
import { routeStretchSchema } from "../../../schemas/shared/alongRoute";
import { IncorrectError } from "../../../types/types";
import { describeStretches, positionAlong, resolveStretches } from "./route-stretch";

/**
 * Ten equal steps east along a parallel, 10 km and 360 s each by `progress`:
 * the Netherlands to point 6, Belgium after; motorway from 2 to 8, urban to 1.
 */
const ROUTE = {
  type: "Feature",
  geometry: {
    type: "LineString",
    coordinates: Array.from({ length: 11 }, (_, index) => [4 + index * 0.1, 50]),
  },
  properties: {
    summary: { lengthInMeters: 100_000, travelTimeInSeconds: 3600 },
    progress: [
      { pointIndex: 0, distanceInMeters: 0, travelTimeInSeconds: 0 },
      { pointIndex: 5, distanceInMeters: 50_000, travelTimeInSeconds: 2400 },
      { pointIndex: 10, distanceInMeters: 100_000, travelTimeInSeconds: 3600 },
    ],
    sections: {
      country: [
        {
          id: "nl",
          startPointIndex: 0,
          endPointIndex: 6,
          countryCodeISO2: "NL",
          countryCodeISO3: "NLD",
        },
        {
          id: "be",
          startPointIndex: 6,
          endPointIndex: 10,
          countryCodeISO2: "BE",
          countryCodeISO3: "BEL",
        },
      ],
      motorway: [{ id: "m", startPointIndex: 2, endPointIndex: 8 }],
      urban: [{ id: "u", startPointIndex: 0, endPointIndex: 1 }],
    },
  },
} as unknown as Route;

const spans = (stretch?: Parameters<typeof resolveStretches>[1]) =>
  resolveStretches(ROUTE, stretch).map(({ fromMeters, toMeters }) => [
    Math.round(fromMeters),
    Math.round(toMeters),
  ]);

const errorOf = (stretch: Parameters<typeof resolveStretches>[1]) => {
  try {
    resolveStretches(ROUTE, stretch);
  } catch (error) {
    return error as IncorrectError;
  }
  throw new Error("expected an error");
};

describe("resolveStretches", () => {
  it("is the whole route without a stretch", () => {
    const [whole] = resolveStretches(ROUTE);
    expect([whole.fromMeters, whole.toMeters]).toEqual([0, 100_000]);
    expect(whole.line).toHaveLength(11);
  });

  it("cuts a window in metres between route points, at the distance the route reports", () => {
    const [stretch] = resolveStretches(ROUTE, { from: 15_000, to: 32_000 });
    expect(stretch.line[0][0]).toBeCloseTo(4.15, 6);
    expect(stretch.line.at(-1)?.[0]).toBeCloseTo(4.32, 6);
    expect(stretch.line.slice(1, -1).map(([lon]) => lon)).toEqual(
      [4.2, 4.3].map((lon) => expect.closeTo(lon, 6))
    );
    expect(stretch.meters).toEqual(
      [15_000, 20_000, 30_000, 32_000].map((meters) => expect.closeTo(meters, 0))
    );
  });

  it("reads a window in seconds off the route's own progress, not its average speed", () => {
    // 2400 s reach 50 km, so the first half hour covers 37.5 km.
    expect(spans({ to: 1800, unit: "seconds" })).toEqual([[0, 37_500]]);
    expect(spans({ from: 3000, unit: "seconds" })).toEqual([[75_000, 100_000]]);
  });

  it("takes a window as a share of the length, or as the last metres", () => {
    expect(spans({ from: 40, to: 60, unit: "percent" })).toEqual([[40_000, 60_000]]);
    expect(spans({ lastMeters: 10_000 })).toEqual([[90_000, 100_000]]);
  });

  it("keeps the included countries and sections inside the window, less the excluded ones", () => {
    expect(spans({ includeCountries: ["be"] })).toEqual([[60_000, 100_000]]);
    expect(spans({ includeSections: ["motorway"], excludeCountries: ["NL"] })).toEqual([
      [60_000, 80_000],
    ]);
    expect(spans({ to: 50_000, excludeSections: ["urban"] })).toEqual([[10_000, 50_000]]);
  });

  it("returns separate stretches, in driving order, when an exclusion splits the window", () => {
    expect(spans({ excludeSections: ["motorway"] })).toEqual([
      [0, 20_000],
      [80_000, 100_000],
    ]);
  });

  it("says what the route crosses when an included country or section is not on it", () => {
    const country = errorOf({ includeCountries: ["FR"] });
    expect(country).toBeInstanceOf(IncorrectError);
    expect(country.message).toContain("crosses none of the countries in `includeCountries`");
    expect(country.data).toMatchObject({
      includeCountries: ["FR"],
      countriesKm: { NL: 60, BE: 40 },
    });

    const section = errorOf({ includeSections: ["lowEmissionZone"] });
    expect(section.message).toContain("none of the sections in `includeSections`");
    expect(section.data).toMatchObject({ sectionsKm: { motorway: 60, urban: 10 } });
  });

  it("says how long the drive is when the window starts after it ends", () => {
    const error = errorOf({ from: 150_000 });
    expect(error.message).toContain("starts after the drive ends");
    expect(error.data).toMatchObject({ lengthKm: 100, travelTimeMinutes: 60 });
  });

  it("says nothing is left when the filters remove the whole window", () => {
    expect(errorOf({ to: 10_000, excludeSections: ["urban"] }).message).toContain(
      "Nothing of the drive is left"
    );
  });
});

describe("positionAlong", () => {
  it("measures a point from the route's start, through the stretch it lies nearest", () => {
    const stretches = resolveStretches(ROUTE, { excludeSections: ["motorway"] });
    const along = positionAlong(stretches, [4.95, 50.001]);
    expect(along?.meters).toBeCloseTo(95_000, -2);
    expect(along?.seconds).toBeCloseTo(3480, -1);
    expect(along?.offRouteMeters).toBeCloseTo(111, -1);
  });
});

describe("describeStretches", () => {
  it("lists each stretch and the total searched, in whole metres", () => {
    const stretches = resolveStretches(ROUTE, { excludeSections: ["motorway"] });
    expect(describeStretches(stretches, ROUTE)).toEqual({
      stretches: [
        { fromMeters: 0, toMeters: 20_000 },
        { fromMeters: 80_000, toMeters: 100_000 },
      ],
      searchedMeters: 40_000,
      routeMeters: 100_000,
    });
  });
});

describe("routeStretchSchema", () => {
  const issues = (input: unknown) =>
    routeStretchSchema.safeParse(input).error?.issues.map(({ message }) => message) ?? [];

  it("takes one window, ordered, with percent kept to 0-100", () => {
    expect(issues({ from: 10, to: 20, unit: "percent" })).toEqual([]);
    expect(issues({ lastMeters: 5000, from: 10 })).toEqual([
      "Give `lastMeters` or `from`/`to`, not both.",
    ]);
    expect(issues({ from: 20, to: 10 })).toEqual(["`to` must be greater than `from`."]);
    expect(issues({ to: 120, unit: "percent" })).toEqual([
      "With unit percent, `from` and `to` are 0-100.",
    ]);
  });

  it("names the code format when a country is given as alpha-3", () => {
    expect(issues({ includeCountries: ["BEL"] })).toEqual([
      'Country codes are ISO 3166-1 alpha-2, e.g. "BE" (not "BEL").',
    ]);
  });
});
