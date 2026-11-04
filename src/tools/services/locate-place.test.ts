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
import type { Position } from "geojson";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadFixture } from "../shared/__fixtures__";
import { LANDMARKS } from "../shared/__fixtures__/landmarks";
import { APP_DATA } from "../shared/app-data";

const mocks = {
  geocodeAreas: vi.fn(),
  fetchBoundaries: vi.fn(),
  fuzzySearch: vi.fn(),
};

vi.mock("../../services/search/searchService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/search/searchService")>()),
  geocodeAreas: mocks.geocodeAreas,
  fetchBoundaries: mocks.fetchBoundaries,
  fuzzySearch: mocks.fuzzySearch,
}));

vi.mock("../shared/inputs/resolve-where", async (importOriginal) => ({
  // The pure name helpers are the real ones — locate-place's ranking IS the
  // thing under test here, and stubbing them would test the stubs.
  ...(await importOriginal<typeof import("../shared/inputs/resolve-where")>()),
  resolveWithin: vi.fn(),
  resolveNearby: vi.fn(),
  describeAreas: vi.fn(() => ""),
}));

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { locatePlaceHandler } = await import("./locate-place");
const { requireDataset } = await import("../../services/datasets/dataset-store");

const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

/** One geocoder-shaped hit, enough for the handler to get past its empty check. */
const oneFeature = (name: string) => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: name,
      geometry: { type: "Point", coordinates: [4.89, 52.37] },
      properties: { address: { freeformAddress: name } },
    },
  ],
});

describe("locatePlaceHandler", () => {
  const candidate = (
    id: string,
    name: string,
    coordinates: Position,
    address: Record<string, string> = {}
  ) => ({
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates },
    properties: { type: "POI", poi: { name }, address },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fuzzySearch.mockResolvedValue(oneFeature("Dam, 1012 Amsterdam"));
  });

  // One request a name: the fuzzy index holds both the places and the
  // addresses, so asking the POI index and the geocoder separately, and the
  // query's area for a bounding box first, tripled what a lookup cost.
  it("asks one search, with the query as given, for several candidates", async () => {
    mocks.fuzzySearch.mockResolvedValue({
      features: [candidate("dam", "Dam Square", [4.893, 52.373], { municipality: "Amsterdam" })],
    });

    await locatePlaceHandler({ query: "Dam Square, Amsterdam", show_ui: false } as never);

    expect(mocks.fuzzySearch).toHaveBeenCalledTimes(1);
    expect(mocks.fuzzySearch).toHaveBeenCalledWith("Dam Square, Amsterdam", { limit: 10 });
    expect(mocks.geocodeAreas).not.toHaveBeenCalled();
  });

  // What the live index returns for this query: first a business called "Dam
  // Square Amsterdam" in Zeist, then businesses on the square. The square
  // itself is not among them.
  it("holds a place's opening hours as the result shows them, and what it located", async () => {
    const places = loadFixture("orbis-poi-search-requested") as {
      features: { properties: { poi?: { openingHours?: unknown } } }[];
    };
    const open = places.features.find(({ properties }) => properties.poi?.openingHours);
    mocks.fuzzySearch.mockResolvedValue({ type: "FeatureCollection", features: [open] });

    const { dataset_id } = parse(await locatePlaceHandler({ query: "the café" } as never));

    const held = requireDataset(dataset_id);
    expect(held.data).toHaveProperty("located");
    expect(held.features[0].properties?.poi.openingHours).toHaveProperty("timeRanges");
    expect(held.features[0].properties?.poi.openingHours).toHaveProperty("today");
  });

  it("prefers a candidate in the area the query names over the search's first", async () => {
    mocks.fuzzySearch.mockResolvedValue({
      features: [
        candidate("zeist", "Dam Square Amsterdam", [5.23, 52.09], { municipality: "Zeist" }),
        candidate("penthouse", "Penthouse Amsterdam Dam Square", [4.89672, 52.37675], {
          municipality: "Amsterdam",
        }),
      ],
    });

    const body = parse(
      await locatePlaceHandler({ query: "Dam Square, Amsterdam", show_ui: false } as never)
    );

    expect(body.located).toBe("Penthouse Amsterdam Dam Square");
    // Nothing was named "Dam Square", so the answer is an inference and says so.
    expect(body.matchNote).toContain('Nothing is named exactly "Dam Square"');
    // …but the disclosure must not read as "distrust this". Measured: the note
    // said "check `located` before relying on the coordinates", and in one
    // benchmark run the model discarded a CORRECT result and answered from
    // general knowledge instead, which the grounding judge scored as invented.
    expect(body.matchNote).toContain("Answer with its coordinates");
    expect(body.matchNote).toContain("Do not replace them with coordinates from memory");
  });

  it("prefers the exact name within the named area over a longer one", async () => {
    mocks.fuzzySearch.mockResolvedValue({
      features: [
        candidate("library", "Rijksmuseum Research Library Amsterdam", [4.885185, 52.360004]),
        candidate("museum", "Rijksmuseum", [4.885219, 52.359998]),
      ],
    });

    const body = parse(
      await locatePlaceHandler({ query: "Rijksmuseum, Amsterdam", show_ui: false } as never)
    );

    expect(body.located).toBe("Rijksmuseum");
    // An exact match is an answer, not a guess.
    expect(body.matchNote).toBeUndefined();
  });

  // An exact name with no area to hold it to proves nothing: "Frankfurt"
  // exactly is a Legoland ride, and the search's first is the city.
  it("keeps the search's order when the query names no area", async () => {
    mocks.fuzzySearch.mockResolvedValue({
      features: [
        candidate("city", "Frankfurt am Main", [8.6821, 50.1109]),
        candidate("ride", "Frankfurt", [9.1275, 55.735]),
      ],
    });

    const body = parse(await locatePlaceHandler({ query: "Frankfurt", show_ui: false } as never));

    expect(body.located).toBe("Frankfurt am Main");
  });

  it("reports a tie between two places of the same name rather than picking one", async () => {
    // Amsterdam really does carry two POIs named exactly "Rijksmuseum", both
    // categorised MUSEUM, 1.7 km apart. Nothing in the data chooses between them.
    mocks.fuzzySearch.mockResolvedValue({
      features: [
        candidate("place-9", "Rijksmuseum", [4.907771, 52.370086]),
        candidate("place-10", "Rijksmuseum", [4.885219, 52.359998]),
      ],
    });

    const body = parse(
      await locatePlaceHandler({ query: "Rijksmuseum, Amsterdam", show_ui: false } as never)
    );

    expect(body.ambiguityNote).toContain("2 places are named exactly");
    expect(body.alternatives).toContain("Rijksmuseum");
  });

  // A centre sent as `position` beside the bbox wins over it, so the hard scope
  // becomes a weak bias. Measured: bbox alone gives "Dam, 1012 Amsterdam";
  // bbox + centre gives "Beaver Dam Place, Zion Crossroads, VA".
  it('constrains a "within" scope by bounding box alone, with no position bias', async () => {
    const { resolveWithin } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveWithin).mockResolvedValue([
      { bbox: [4.7289, 52.278009, 5.107671, 52.431229], label: "Amsterdam" },
    ] as never);

    await locatePlaceHandler({
      query: "Dam Square",
      where: { mode: "within", queries: ["Amsterdam"] },
      show_ui: false,
    } as never);

    const options = mocks.fuzzySearch.mock.calls[0][1];
    expect(options.boundingBox).toEqual([4.7289, 52.278009, 5.107671, 52.431229]);
    expect(options).not.toHaveProperty("position");
    // Only the bounds constrain a lookup, so no outline is paid for.
    expect(resolveWithin).toHaveBeenCalledWith(expect.anything(), {
      allowCountry: true,
      boundsOnly: true,
    });
  });

  it("searches once, unbounded, when `within` names again the area the query names", async () => {
    const { resolveWithin } = await import("../shared/inputs/resolve-where");
    mocks.fuzzySearch.mockResolvedValue({
      features: [candidate("dam", "Dam Square", [4.893, 52.373], { municipality: "Amsterdam" })],
    });

    const body = parse(
      await locatePlaceHandler({
        query: "Dam Square, Amsterdam",
        where: { mode: "within", queries: ["Amsterdam"] },
      })
    );

    expect(body.located).toBe("Dam Square");
    expect(mocks.fuzzySearch).toHaveBeenCalledTimes(1);
    expect(mocks.fuzzySearch.mock.calls[0][1]).not.toHaveProperty("boundingBox");
    expect(resolveWithin).not.toHaveBeenCalled();
  });

  it("searches again within the area's bounds when the best match lies outside it", async () => {
    const { resolveWithin } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveWithin).mockResolvedValue([
      { bbox: [4.7289, 52.278009, 5.107671, 52.431229], label: "Amsterdam" },
    ] as never);
    mocks.fuzzySearch
      .mockResolvedValueOnce({
        features: [
          candidate("zeist", "Dam Square Amsterdam", [5.23, 52.09], { municipality: "Zeist" }),
        ],
      })
      .mockResolvedValueOnce({
        features: [candidate("dam", "Dam Square", [4.893, 52.373], { municipality: "Amsterdam" })],
      });

    const body = parse(
      await locatePlaceHandler({
        query: "Dam Square, Amsterdam",
        where: { mode: "within", queries: ["Amsterdam"] },
      })
    );

    expect(body.located).toBe("Dam Square");
    expect(mocks.fuzzySearch).toHaveBeenCalledTimes(2);
    expect(mocks.fuzzySearch.mock.calls[0][1]).not.toHaveProperty("boundingBox");
    expect(mocks.fuzzySearch.mock.calls[1][1].boundingBox).toEqual([
      4.7289, 52.278009, 5.107671, 52.431229,
    ]);
  });

  it('constrains a "within" scope of several areas by the bounds of them all', async () => {
    const { resolveWithin } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveWithin).mockResolvedValue([
      { bbox: [4.7289, 52.278009, 5.107671, 52.431229], label: "Amsterdam" },
      { bbox: [4.35, 51.85, 4.6, 52.0], label: "Rotterdam" },
    ] as never);

    await locatePlaceHandler({
      query: "Markthal",
      where: { mode: "within", queries: ["Amsterdam", "Rotterdam"] },
      show_ui: false,
    } as never);

    expect(mocks.fuzzySearch.mock.calls[0][1].boundingBox).toEqual([
      4.35, 51.85, 5.107671, 52.431229,
    ]);
  });

  it("gives the app the located place and the alternatives the text names, no more", async () => {
    mocks.fuzzySearch.mockResolvedValue({
      features: [0, 1, 2, 3, 4, 5, 6].map((index) =>
        candidate(`rijksmuseum-${index}`, `Rijksmuseum ${index}`, [4.88 + index / 10, 52.36])
      ),
    });

    const response = await locatePlaceHandler({ query: "Rijksmuseum", show_ui: true } as never);
    const body = parse(response);
    const drawn = response[APP_DATA]?.data as { features: { id: string }[] };

    expect(body.alternatives).toHaveLength(3);
    expect(drawn.features).toHaveLength(4);
    expect(drawn.features[0].id).toBe("rijksmuseum-0");
  });

  it('passes a "nearby" scope as a position bias, without a radius it was not given', async () => {
    const { resolveNearby } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveNearby).mockResolvedValue({ position: [4.9, 52.37], radiusMeters: 1000 });

    await locatePlaceHandler({
      query: "Dam Square",
      where: { mode: "nearby", query: "Amsterdam" },
      show_ui: false,
    } as never);

    const options = mocks.fuzzySearch.mock.calls[0][1];
    expect(options.position).toEqual([4.9, 52.37]);
    expect(options).not.toHaveProperty("radius");
    expect(options).not.toHaveProperty("boundingBox");
  });

  it('keeps a "nearby" scope\'s radiusMeters', async () => {
    const { resolveNearby } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveNearby).mockResolvedValue({ position: [4.9, 52.37], radiusMeters: 500 });

    await locatePlaceHandler({
      query: "Dam Square",
      where: { mode: "nearby", position: [4.9, 52.37], radiusMeters: 500 },
      show_ui: false,
    } as never);

    expect(mocks.fuzzySearch.mock.calls[0][1]).toMatchObject({
      position: [4.9, 52.37],
      radius: 500,
    });
  });

  it("fails, suggesting a narrower lookup, when nothing matches", async () => {
    mocks.fuzzySearch.mockResolvedValue({ type: "FeatureCollection", features: [] });

    const response = await locatePlaceHandler({ query: "Xyzzy Plaza" });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("Could not locate the query");
  });

  it("reports a failing API as the failure, not as a name that was not found", async () => {
    mocks.fuzzySearch.mockRejectedValue(new Error("403 Forbidden"));

    const response = await locatePlaceHandler({ query: "Dam Square" });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("403 Forbidden");
    expect(response.content[0].text).not.toContain("Could not locate");
  });
});

describe("locatePlaceHandler boundaries", () => {
  const square = {
    type: "Polygon",
    coordinates: [
      [
        [4.87, 52.37],
        [4.89, 52.37],
        [4.89, 52.39],
        [4.87, 52.37],
      ],
    ],
  };
  const jordaan = (freeformAddress: string) => ({
    type: "Feature",
    id: freeformAddress,
    bbox: [4.87, 52.37, 4.89, 52.39],
    geometry: { type: "Point", coordinates: [4.88, 52.38] },
    properties: {
      type: "Geography",
      address: { freeformAddress },
      dataSources: { geometry: { id: "b-1" } },
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fuzzySearch.mockResolvedValue({
      type: "FeatureCollection",
      features: [jordaan("Jordaan, Amsterdam"), oneFeature("Café Jordaan, Amsterdam").features[0]],
    });
    mocks.fetchBoundaries.mockResolvedValue({ features: [{ id: "b-1", geometry: square }] });
  });

  it("returns the area's boundary polygon when geometry is asked for", async () => {
    const response = await locatePlaceHandler({ query: "Jordaan", response_detail: "geometry" });
    const body = parse(response);

    expect(body.located).toBe("Jordaan, Amsterdam");
    expect(body.area).toEqual({
      name: "Jordaan, Amsterdam",
      boundingBox: [4.87, 52.37, 4.89, 52.39],
      boundaryId: "b-1",
    });
    expect(body.boundaryNote).toMatch(/last feature \(index \d+, `properties.boundaryOf`\)/);
    expect(body.geometry.features).toHaveLength(1);
    expect(body.geometry.features[0]).toMatchObject({
      geometry: { type: "Polygon" },
      properties: { place: 0 },
    });
  });

  it("holds the boundary as its dataset's last feature, for `within.dataset_ids`", async () => {
    const { dataset_id } = parse(
      await locatePlaceHandler({ query: "Jordaan", response_detail: "geometry" })
    );

    expect(requireDataset(dataset_id).features.at(-1)).toMatchObject({
      geometry: { type: "Polygon" },
      properties: { boundaryOf: "Jordaan, Amsterdam" },
    });
  });

  it("says the boundary service was unavailable, not that the place has no boundary", async () => {
    mocks.fetchBoundaries.mockRejectedValueOnce(
      Object.assign(new Error("Too Many Requests"), { status: 429 })
    );
    const body = parse(await locatePlaceHandler({ query: "Jordaan", response_detail: "geometry" }));

    expect(body.located).toBe("Jordaan, Amsterdam");
    expect(body.boundaryNote).toMatch(
      /boundary service was unavailable \(Rate limit exceeded.*Try again/
    );
  });

  it("does not fetch boundaries when no geometry is asked for, and locates the same place", async () => {
    const response = await locatePlaceHandler({ query: "Jordaan" });

    expect(mocks.fetchBoundaries).not.toHaveBeenCalled();
    expect(parse(response).located).toBe("Jordaan, Amsterdam");
    expect(parse(response).features).toHaveLength(1);
  });

  it("says so, and returns the point, when the place has no boundary", async () => {
    mocks.fuzzySearch.mockResolvedValue(oneFeature("Café Jordaan, Amsterdam"));

    const body = parse(
      await locatePlaceHandler({ query: "Café Jordaan", response_detail: "geometry" })
    );

    expect(body.boundaryNote).toContain("no boundary polygon");
    expect(body.geometry.features[0].geometry.type).toBe("Point");
    expect(body.area).toBeUndefined();
  });
});

describe("locatePlaceHandler on recorded answers", () => {
  const recorded = loadFixture("landmarks");

  it.each(LANDMARKS)("$query", async ({ query, at, withinMeters, areaLookup }) => {
    mocks.fuzzySearch.mockReset().mockResolvedValue(recorded[query]);
    // The area lookup is not recorded: finding no area leaves the fuzzy answer standing.
    mocks.geocodeAreas.mockReset().mockResolvedValue({ type: "FeatureCollection", features: [] });

    const [top] = parse(await locatePlaceHandler({ query })).features;

    expect(mocks.fuzzySearch).toHaveBeenCalledTimes(1);
    expect(mocks.geocodeAreas).toHaveBeenCalledTimes(areaLookup ? 1 : 0);
    expect(turf.distance(top.geometry.coordinates, at, { units: "meters" })).toBeLessThanOrEqual(
      withinMeters
    );
  });
});
