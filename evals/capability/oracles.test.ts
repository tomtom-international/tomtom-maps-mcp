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

import type { Moment, OpeningHours, Place } from "@tomtom-org/maps-sdk/core";
import type { Polygon } from "geojson";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchInAreas } from "../../src/services/search/searchService";
import { openAt, opensOn, placesIn, secondsToVertex, tally } from "./oracles";

vi.mock("../../src/services/search/searchService", () => ({
  fuzzySearch: vi.fn(),
  searchInAreas: vi.fn(),
}));
vi.mock("../../src/tools/shared/inputs/resolve-poi-categories", () => ({
  resolvePoiCategories: async (categories: string[]) => ({ resolved: categories }),
}));

/** A place at a fixed point, with the given opening hours. */
const place = (id: string, openingHours?: OpeningHours): Place => ({
  type: "Feature",
  id,
  geometry: { type: "Point", coordinates: [4.9, 52.37] },
  properties: {
    type: "POI",
    address: { freeformAddress: `${id} street` },
    poi: { name: id, categories: [], localizedCategories: [], openingHours },
  },
});

const moment = (day: number, hour: number, minute = 0): Moment => {
  const date = new Date(Date.UTC(2026, 10, day, hour, minute));
  return {
    date,
    dateYYYYMMDD: `202611${String(day).padStart(2, "0")}`,
    year: 2026,
    month: 11,
    day,
    hour,
    minute,
  };
};

const hours = (...ranges: [start: Moment, end: Moment][]): OpeningHours => ({
  mode: "nextSevenDays",
  timeRanges: ranges.map(([start, end]) => ({ start, end })),
  alwaysOpenThisPeriod: false,
});

const square = (index: number): Polygon => ({
  type: "Polygon",
  coordinates: [
    [
      [index, 0],
      [index + 1, 0],
      [index + 1, 1],
      [index, 0],
    ],
  ],
});

describe("placesIn", () => {
  const search = vi.mocked(searchInAreas);
  let inFlight = 0;
  let mostInFlight = 0;

  /** Answers each area with `perArea` places, ids by area, as one page of at most `limit`. */
  const answerWith = (perArea: number) =>
    search.mockImplementation(async (_query, areas, options) => {
      inFlight += 1;
      mostInFlight = Math.max(mostInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      const features = areas
        .flatMap((area) => {
          const west = area.type === "Polygon" ? area.coordinates[0][0][0] : Number.NaN;
          return Array.from({ length: perArea }, (_, index) => place(`${west}-${index}`));
        })
        .slice(0, options?.limit);
      // A page carries a search summary the helper never reads.
      return { type: "FeatureCollection", features } as Awaited<ReturnType<typeof searchInAreas>>;
    });

  beforeEach(() => {
    inFlight = 0;
    mostInFlight = 0;
  });
  afterEach(() => search.mockReset());

  it("searches up to 50 areas a request, one request at a time", async () => {
    answerWith(1);
    const places = await placesIn(
      ["cafe"],
      Array.from({ length: 120 }, (_, index) => square(index))
    );
    expect(search.mock.calls.map(([, areas]) => areas.length)).toEqual([50, 50, 20]);
    expect(mostInFlight).toBe(1);
    expect(places).toHaveLength(120);
  });

  it("splits a request that comes back full until none does", async () => {
    answerWith(30);
    const places = await placesIn(
      ["cafe"],
      Array.from({ length: 4 }, (_, index) => square(index))
    );
    expect(search.mock.calls.map(([, areas]) => areas.length)).toEqual([4, 2, 2]);
    expect(places).toHaveLength(120);
  });

  it("counts each place once when areas overlap", async () => {
    answerWith(2);
    const places = await placesIn(["cafe"], [square(0), square(0)]);
    expect(places.map(({ id }) => id)).toEqual(["0-0", "0-1"]);
  });

  it("throws when one area alone fills a page, since the reference would be capped", async () => {
    answerWith(100);
    await expect(placesIn(["cafe"], [square(0)])).rejects.toThrow(/full page/);
  });

  it("takes a full page as the answer when the question asks for at most that many", async () => {
    answerWith(100);
    const places = await placesIn(["cafe"], [square(0)], { upToLimit: true });
    expect(places).toHaveLength(100);
    expect(search).toHaveBeenCalledTimes(1);
  });
});

describe("openAt", () => {
  const bistro = place("bistro", hours([moment(7, 18), moment(7, 23, 30)]));

  it("is true inside a range, its start included and its end not", () => {
    expect(openAt(bistro, moment(7, 18))).toBe(true);
    expect(openAt(bistro, moment(7, 23, 29))).toBe(true);
    expect(openAt(bistro, moment(7, 23, 30))).toBe(false);
    expect(openAt(bistro, moment(8, 19))).toBe(false);
  });

  it("is undefined for a place with no known hours", () => {
    expect(openAt(place("unknown"), moment(7, 18))).toBeUndefined();
  });
});

describe("opensOn", () => {
  it("gives the earliest opening that day, skipping a range carried over from midnight", () => {
    const cafe = place(
      "cafe",
      hours(
        [moment(8, 0), moment(8, 2)],
        [moment(8, 13), moment(8, 17)],
        [moment(8, 7, 30), moment(8, 11)]
      )
    );
    expect(opensOn(cafe, { year: 2026, month: 11, day: 8 })).toBe("07:30");
  });

  it("is undefined on a day it does not open", () => {
    const cafe = place("cafe", hours([moment(8, 0), moment(8, 2)]));
    expect(opensOn(cafe, { year: 2026, month: 11, day: 8 })).toBeUndefined();
    expect(opensOn(place("unknown"), { year: 2026, month: 11, day: 8 })).toBeUndefined();
  });
});

describe("secondsToVertex", () => {
  const progress = [
    { pointIndex: 0, travelTimeInSeconds: 0 },
    { pointIndex: 10, travelTimeInSeconds: 100 },
    { pointIndex: 20, travelTimeInSeconds: 300 },
  ];

  it("interpolates between the progress points around a vertex", () => {
    expect(secondsToVertex(progress, 5)).toBe(50);
    expect(secondsToVertex(progress, 15)).toBe(200);
  });

  it("takes a progress point's own time at its vertex", () => {
    expect(secondsToVertex(progress, 0)).toBe(0);
    expect(secondsToVertex(progress, 10)).toBe(100);
  });

  it("takes the last point's time past the end of the route", () => {
    expect(secondsToVertex(progress, 25)).toBe(300);
  });
});

describe("tally", () => {
  it("counts by key, most first", () => {
    expect(tally(["a", "b", "b", "c", "b", "a"], (item) => item)).toEqual([
      ["b", 3],
      ["a", 2],
      ["c", 1],
    ]);
  });
});
