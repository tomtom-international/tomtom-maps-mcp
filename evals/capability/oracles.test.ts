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
import type { LineString, Polygon, Position } from "geojson";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchInAreas } from "../../src/services/search/searchService";
import {
  alongLine,
  brandsOf,
  brandTally,
  byDistanceFrom,
  categoryOf,
  firstVertex,
  groupedWithin,
  h3Cells,
  hasConnectorOf,
  incidentsNear,
  km,
  listedBrand,
  listTop,
  metresFromLine,
  openAt,
  opensOn,
  placesAroundEach,
  placesIn,
  secondsToVertex,
  sectionLengths,
  stretchOf,
  tally,
  withinAny,
} from "./oracles";

vi.mock("../../src/services/search/searchService", () => ({
  fuzzySearch: vi.fn(),
  searchInAreas: vi.fn(),
}));
vi.mock("../../src/tools/shared/inputs/resolve-poi-categories", () => ({
  resolvePoiCategories: async (categories: string[]) => ({ resolved: categories }),
}));

type PoiFields = Partial<NonNullable<Place["properties"]["poi"]>>;

/** A place named `id`, at `coordinates`, with the given POI fields. */
const place = (
  id: string,
  poi: PoiFields = {},
  coordinates: Position = [4.9, 52.37],
  properties: Partial<Place["properties"]> = {}
): Place => ({
  type: "Feature",
  id,
  geometry: { type: "Point", coordinates },
  properties: {
    type: "POI",
    address: { freeformAddress: `${id} street` },
    poi: { name: id, categories: [], localizedCategories: [], ...poi },
    ...properties,
  },
});

/** A place at `metres` east of [4.9, 52.37] along its parallel. */
const eastBy = (id: string, metres: number): Place =>
  place(id, {}, [4.9 + metres / (111_320 * Math.cos((52.37 * Math.PI) / 180)), 52.37]);

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
  const bistro = place("bistro", { openingHours: hours([moment(7, 18), moment(7, 23, 30)]) });

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
    const cafe = place("cafe", {
      openingHours: hours(
        [moment(8, 0), moment(8, 2)],
        [moment(8, 13), moment(8, 17)],
        [moment(8, 7, 30), moment(8, 11)]
      ),
    });
    expect(opensOn(cafe, { year: 2026, month: 11, day: 8 })).toBe("07:30");
  });

  it("is undefined on a day it does not open", () => {
    const cafe = place("cafe", { openingHours: hours([moment(8, 0), moment(8, 2)]) });
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

describe("placesAroundEach", () => {
  const search = vi.mocked(searchInAreas);
  afterEach(() => search.mockReset());

  it("keeps the places within reach of a centre, and groups them by centre, most first", async () => {
    const [west, east] = [eastBy("west", 0), eastBy("east", 1000)];
    const found = [eastBy("by-west", 50), eastBy("by-east", 980), eastBy("between", 500)];
    search.mockResolvedValue({ type: "FeatureCollection", features: found } as Awaited<
      ReturnType<typeof searchInAreas>
    >);
    const { places, groups } = await placesAroundEach(["cafe"], [west, east], 100);
    expect(search.mock.calls[0][1]).toHaveLength(2);
    expect(places.map(({ id }) => id)).toEqual(["by-west", "by-east"]);
    expect(groups.map(({ centre, near }) => [centre.id, near.length])).toEqual([
      ["west", 1],
      ["east", 1],
    ]);
  });
});

describe("brands", () => {
  // `brands` is typed `string[]`, but `listedBrand` also takes the `{ name }` objects it may hold.
  const shop = (name: string, brands?: unknown[]) =>
    place(name, { brands: brands as string[] | undefined });

  it("prefers the listed brand the name holds, else the first in Latin script", () => {
    expect(listedBrand(shop("Esso Utrecht", ["Aisuo", "埃索", "Esso"]))).toBe("Esso");
    expect(listedBrand(shop("Station 12", ["埃索", "Esso"]))).toBe("Esso");
    expect(listedBrand(shop("Station 12", [{ name: "Shell" }]))).toBe("Shell");
    expect(listedBrand(shop("Station 12", []))).toBeUndefined();
  });

  it("gives an unbranded place the brand another place lists, when its name holds it", () => {
    const places = [
      shop("Albert Heijn Utrecht", ["Albert Heijn"]),
      shop("Albert Heijn Rotterdam Centrum"),
      shop("ALBERT HEIJN to go"),
      shop("Albert Heijnsma Bakkerij"),
      shop("Jumbo Centrum"),
    ];
    expect(brandsOf(places)).toEqual([
      "Albert Heijn",
      "Albert Heijn",
      "Albert Heijn",
      undefined,
      undefined,
    ]);
  });

  it("takes the longest brand an unbranded name holds", () => {
    const places = [
      shop("Albert Heijn", ["Albert Heijn"]),
      shop("Albert Heijn XL", ["Albert Heijn XL"]),
      shop("Albert Heijn XL Leidsche Rijn"),
    ];
    expect(brandsOf(places)[2]).toBe("Albert Heijn XL");
  });

  it("tallies brands, leaving out the places with none", () => {
    const places = [
      shop("Albert Heijn Utrecht", ["Albert Heijn"]),
      shop("Albert Heijn Rotterdam Centrum"),
      shop("Jumbo Centrum", ["Jumbo"]),
      shop("Buurtsuper De Hoek"),
    ];
    expect(brandTally(places)).toEqual([
      ["Albert Heijn", 2],
      ["Jumbo", 1],
    ]);
  });
});

describe("place fields", () => {
  const station = (ratedPowerKW: number) =>
    place("station", {}, undefined, {
      chargingPark: {
        connectors: [
          {
            connector: {
              type: "IEC62196Type2CCS",
              ratedPowerKW,
              chargingSpeed: "regular",
              voltageV: 400,
              currentA: 32,
              currentType: "AC3",
            },
            count: 2,
          },
        ],
      },
    });

  it("finds a connector at or above a power", () => {
    expect(hasConnectorOf(station(22), 22)).toBe(true);
    expect(hasConnectorOf(station(11), 22)).toBe(false);
    expect(hasConnectorOf(place("no park"), 22)).toBe(false);
  });

  it("takes a restaurant's most specific category", () => {
    expect(categoryOf(place("a", { categories: ["RESTAURANT", "ITALIAN_RESTAURANT"] }))).toBe(
      "ITALIAN_RESTAURANT"
    );
    expect(categoryOf(place("b", { categories: ["RESTAURANT"] }))).toBe("RESTAURANT");
  });
});

describe("geometry", () => {
  const line: LineString = {
    type: "LineString",
    coordinates: [
      [4.9, 52.37],
      [4.92, 52.37],
      [4.94, 52.37],
    ],
  };

  it("orders places by distance from a point, and along a line", () => {
    const [near, far] = [eastBy("near", 100), eastBy("far", 2000)];
    expect(byDistanceFrom([4.9, 52.37], [far, near]).map(({ place: { id } }) => id)).toEqual([
      "near",
      "far",
    ]);
    const along = alongLine(line, [far, near]);
    expect(along.map(({ place: { id } }) => id)).toEqual(["near", "far"]);
    expect(along[1].metres).toBeCloseTo(2000, -1);
  });

  it("groups places by the centres within reach, the most first", () => {
    const [a, b] = [eastBy("a", 0), eastBy("b", 1000)];
    const places = [eastBy("p1", 950), eastBy("p2", 1050), eastBy("p3", 40), eastBy("far", 3000)];
    expect(withinAny(places, [a, b], 100).map(({ id }) => id)).toEqual(["p1", "p2", "p3"]);
    expect(
      groupedWithin([a, b], places, 100).map(({ centre, near }) => [centre.id, near.length])
    ).toEqual([
      ["b", 2],
      ["a", 1],
    ]);
  });

  it("finds the incidents near a line in the order a drive reaches them", () => {
    const incident = (id: string, coordinates: Position[]) => ({
      id,
      geometry: { type: "LineString" as const, coordinates },
    });
    const near = incidentsNear(
      line,
      [
        incident("later", [
          [4.935, 52.3701],
          [4.936, 52.3701],
        ]),
        incident("off the route", [[4.91, 52.38]]),
        incident("sooner", [
          [4.905, 52.37],
          [4.906, 52.37],
        ]),
      ],
      50
    );
    expect(near.map(({ incident: { id } }) => id)).toEqual(["sooner", "later"]);
    expect(near[0].index).toBe(0);
    expect(near[1].index).toBe(1);
  });

  it("measures a geometry from its vertices", () => {
    expect(
      firstVertex({
        type: "MultiLineString",
        coordinates: [
          [
            [1, 2],
            [3, 4],
          ],
        ],
      })
    ).toEqual([1, 2]);
    expect(metresFromLine({ type: "Point", coordinates: [4.92, 52.37] }, line)).toBeCloseTo(0, 3);
  });

  it("cuts a stretch out of a route and measures its sections", () => {
    expect(stretchOf(line, 1, 2).coordinates).toEqual(line.coordinates.slice(1));
    const [whole, half] = sectionLengths(line, [
      { id: "a", startPointIndex: 0, endPointIndex: 2 },
      { id: "b", startPointIndex: 0, endPointIndex: 1 },
    ]);
    expect(half * 2).toBeCloseTo(whole, 0);
  });

  it("counts places by H3 cell, most first", () => {
    const [first, ...rest] = h3Cells([eastBy("a", 0), eastBy("b", 5), eastBy("c", 5000)], 9);
    expect(first[1]).toBe(2);
    expect(rest).toHaveLength(1);
  });
});

describe("reference text", () => {
  it("writes kilometres and the top of a tally", () => {
    expect(km(1234)).toBe("1.2");
    expect(
      listTop([
        ["a", 3],
        ["b", 2],
        ["c", 1],
        ["d", 1],
      ])
    ).toBe("a 3, b 2, c 1");
    expect(listTop([["Shell", 120]], 3, "kW")).toBe("Shell 120 kW");
  });
});
