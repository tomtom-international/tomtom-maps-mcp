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

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = {
  geocodeAddress: vi.fn(),
  poiSearch: vi.fn(),
  searchInArea: vi.fn(),
  storeDataset: vi.fn(),
  withEVAvailability: vi.fn(),
};

vi.mock("../../services/search/searchService", () => ({
  geocodeAddress: mocks.geocodeAddress,
  poiSearch: mocks.poiSearch,
  fuzzySearch: vi.fn(),
  searchEVStations: vi.fn(),
  searchInArea: mocks.searchInArea,
  searchNearby: vi.fn(),
  withEVAvailability: mocks.withEVAvailability,
}));

vi.mock("../../services/datasets/dataset-store", () => ({
  datasetMeta: (d: { id: string }, showUi: boolean) => ({
    show_ui: showUi,
    dataset_id: d.id,
    dataset_expires_in_seconds: 600,
  }),
  storeDataset: mocks.storeDataset,
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

const { discoverPlacesHandler, locatePlaceHandler } = await import("./discover-places");

const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

/** One geocoder-shaped hit, enough for the handler to get past its empty check. */
const oneFeature = (name: string) => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [4.89, 52.37] },
      properties: { address: { freeformAddress: name } },
    },
  ],
});

// Measured against the live API: a category filter plus `query: "*"` returns
// ZERO features from the geometry and fuzzy endpoints, where "*" is a literal
// search term rather than a wildcard. `""` is the category-only search and
// returns results. This broke the flagship shape of the whole consolidation —
// "Italian restaurants in Amsterdam" as poiCategories + where.within — and
// every eval missed it: the selection suites assert which tool was called, and
// the capability judge scored an empty result as an honest "nothing found".
describe("category-only search", () => {
  beforeEach(async () => {
    const { resolveWithin } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveWithin).mockResolvedValue({
      value: [{ bbox: [4.7289, 52.278009, 5.107671, 52.431229], label: "Amsterdam" }],
    } as never);
    mocks.searchInArea.mockResolvedValue({ type: "FeatureCollection", features: [] });
  });

  it("sends an empty query, not a literal asterisk, when only categories are given", async () => {
    await discoverPlacesHandler({
      poiCategories: ["RESTAURANT"],
      where: { mode: "within", queries: ["Amsterdam"] },
      show_ui: false,
    } as never);

    expect(mocks.searchInArea).toHaveBeenCalledWith(
      expect.objectContaining({ query: "", poiCategories: ["RESTAURANT"] })
    );
    expect(mocks.searchInArea).not.toHaveBeenCalledWith(expect.objectContaining({ query: "*" }));
  });

  it("still passes the caller's free text when there is some", async () => {
    await discoverPlacesHandler({
      query: "italian",
      poiCategories: ["RESTAURANT"],
      where: { mode: "within", queries: ["Amsterdam"] },
      show_ui: false,
    } as never);

    expect(mocks.searchInArea).toHaveBeenCalledWith(expect.objectContaining({ query: "italian" }));
  });
});

// Live charger availability used to be attached only on the nearby + position
// path, which is the one that inherited `ev-search`. The same question scoped
// to an AREA came back with stations and no availability, and the model filled
// the gap in from nothing: measured over five runs, `lookup-ev-availability`
// was the one task where the new surface scored WORSE than the old one.
describe("EV availability", () => {
  const evStation = {
    type: "Feature",
    geometry: { type: "Point", coordinates: [4.89, 52.37] },
    properties: { type: "POI", poi: { name: "Charger" }, chargingPark: { connectors: [] } },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.storeDataset.mockReturnValue({ id: "ds_test" });
    const { resolveWithin } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveWithin).mockResolvedValue({
      value: [{ bbox: [4.7, 52.3, 5.0, 52.4], label: "Amsterdam" }],
    } as never);
    mocks.searchInArea.mockResolvedValue({ type: "FeatureCollection", features: [evStation] });
    mocks.withEVAvailability.mockImplementation(async (r: unknown) => r);
  });

  it("enriches an EV search scoped to an area, not just one around a point", async () => {
    await discoverPlacesHandler({
      poiCategories: ["ELECTRIC_VEHICLE_STATION"],
      where: { mode: "within", queries: ["Amsterdam"] },
      show_ui: false,
    } as never);

    expect(mocks.withEVAvailability).toHaveBeenCalledTimes(1);
  });

  it("leaves a non-EV area search alone", async () => {
    await discoverPlacesHandler({
      poiCategories: ["RESTAURANT"],
      where: { mode: "within", queries: ["Amsterdam"] },
      show_ui: false,
    } as never);

    expect(mocks.withEVAvailability).not.toHaveBeenCalled();
  });
});

describe("locatePlaceHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storeDataset.mockReturnValue({ id: "ds_test" });
    mocks.geocodeAddress.mockResolvedValue(oneFeature("Mill Dam Place, Leesburg, VA"));
    mocks.poiSearch.mockResolvedValue(oneFeature("Dam, Amsterdam"));
  });

  // Neither index answers this alone, which is why both are consulted. Asked for
  // "Dam Square, Amsterdam" the POI index returns Penthouse Amsterdam Dam Square,
  // Hotel Damsquare and Dam Square Inn — businesses named after the square, with
  // the square itself nowhere in the list — while the geocoder scoped to
  // Amsterdam returns "Dam, 1012 Amsterdam", which is the answer. Picking one
  // index up front means being wrong whenever the guess was wrong, and the model
  // then answers from memory: measured, it stated Dam Square's real coordinates
  // while the tool result held a hotel's, and the grounding judge called that
  // fabrication. It was the tool that was wrong.
  it("consults both indexes rather than betting on one", async () => {
    await locatePlaceHandler({
      query: "Dam Square, Amsterdam",
      queryAs: "poi",
      show_ui: false,
    } as never);

    expect(mocks.poiSearch).toHaveBeenCalledWith("Dam Square, Amsterdam", expect.anything());
    expect(mocks.geocodeAddress).toHaveBeenCalledWith("Dam Square, Amsterdam", expect.anything());
  });

  it("prefers the place itself over a business named after it", async () => {
    // What the live indexes actually return for this query.
    mocks.poiSearch.mockResolvedValue({
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [4.89672, 52.37675] },
          properties: { type: "POI", poi: { name: "Penthouse Amsterdam Dam Square" } },
        },
      ],
    });
    mocks.geocodeAddress.mockResolvedValue({
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [4.892792, 52.3728111] },
          properties: { type: "Street", address: { freeformAddress: "Dam, 1012 Amsterdam" } },
        },
      ],
    });

    const body = parse(
      await locatePlaceHandler({
        query: "Dam Square, Amsterdam",
        queryAs: "poi",
        show_ui: false,
      } as never)
    );

    expect(body.located).toBe("Dam, 1012 Amsterdam");
    // Nothing was named "Dam Square", so the answer is an inference and says so.
    expect(body.matchNote).toContain('Nothing is named exactly "Dam Square"');
    // …but the disclosure must not read as "distrust this". Measured: the note
    // said "check `located` before relying on the coordinates", and in one
    // benchmark run the model discarded a CORRECT result and answered from
    // general knowledge instead, which the grounding judge scored as invented.
    expect(body.matchNote).toContain("report");
    expect(body.matchNote).toContain("Do not replace them with coordinates from memory");
  });

  it("prefers an exact name match over a longer name that contains it", async () => {
    mocks.poiSearch.mockResolvedValue({
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [4.885185, 52.360004] },
          properties: { type: "POI", poi: { name: "Rijksmuseum Research Library Amsterdam" } },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [4.885219, 52.359998] },
          properties: { type: "POI", poi: { name: "Rijksmuseum" } },
        },
      ],
    });
    mocks.geocodeAddress.mockResolvedValue(oneFeature("Amsterdam"));

    const body = parse(
      await locatePlaceHandler({ query: "Rijksmuseum, Amsterdam", show_ui: false } as never)
    );

    expect(body.located).toBe("Rijksmuseum");
    // An exact match is an answer, not a guess.
    expect(body.matchNote).toBeUndefined();
  });

  it("reports a tie between two places of the same name rather than picking one", async () => {
    // Amsterdam really does carry two POIs named exactly "Rijksmuseum", both
    // categorised MUSEUM, 1.7 km apart. Nothing in the data chooses between them.
    mocks.poiSearch.mockResolvedValue({
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [4.907771, 52.370086] },
          properties: { type: "POI", poi: { name: "Rijksmuseum" } },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [4.885219, 52.359998] },
          properties: { type: "POI", poi: { name: "Rijksmuseum" } },
        },
      ],
    });
    mocks.geocodeAddress.mockResolvedValue({ features: [] });

    const body = parse(
      await locatePlaceHandler({ query: "Rijksmuseum, Amsterdam", show_ui: false } as never)
    );

    expect(body.ambiguityNote).toContain("2 places are named exactly");
    expect(body.alternatives).toContain("Rijksmuseum");
  });

  // The query names its own scope and nothing was reading it, so a global index
  // was free to answer in the wrong country: "Eiffel Tower, Paris" found Paris,
  // Texas, and "Dam Square, Amsterdam" found Leesburg, Virginia.
  it("scopes the lookup to the area named in the query itself", async () => {
    const { resolveWithin } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveWithin).mockResolvedValue({
      value: [{ bbox: [4.7289, 52.278009, 5.107671, 52.431229], label: "Amsterdam" }],
    } as never);

    await locatePlaceHandler({ query: "Dam Square, Amsterdam", show_ui: false } as never);

    expect(resolveWithin).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "within", queries: ["Amsterdam"] })
    );
    // …and the bounds it produced reach BOTH searches, not just one.
    expect(mocks.poiSearch.mock.calls.at(-1)?.[1]?.boundingBox).toBeDefined();
    expect(mocks.geocodeAddress.mock.calls.at(-1)?.[1]?.boundingBox).toBeDefined();
  });

  it("does not invent a scope when the query names no area", async () => {
    const { resolveWithin } = await import("../shared/inputs/resolve-where");
    await locatePlaceHandler({ query: "Rijksmuseum", show_ui: false } as never);

    expect(resolveWithin).not.toHaveBeenCalled();
    expect(mocks.poiSearch.mock.calls.at(-1)?.[1]?.boundingBox).toBeUndefined();
  });

  // A tail that is not a place must not fail the lookup it was only meant to
  // narrow — an unscoped answer is worse than a scoped one, not an error.
  it("still answers when the area in the query cannot be resolved", async () => {
    const { resolveWithin } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveWithin).mockRejectedValue(new Error("no such area"));

    const body = parse(
      await locatePlaceHandler({
        query: "Rijksmuseum, the one near the park",
        show_ui: false,
      } as never)
    );

    expect(body.located).toBeDefined();
    expect(mocks.poiSearch.mock.calls.at(-1)?.[1]?.boundingBox).toBeUndefined();
  });

  // The scope lookup is one more network call and the network is not reliable.
  // When it fails the search runs unscoped, and an unscoped geocoder answers
  // "Dam Square, Amsterdam" with Mill Dam Place, Leesburg, Virginia. Ranking the
  // place-over-business rule above geography would put that US street first —
  // worse than the hotel it replaced, and wrong in a way a user cannot see.
  it("keeps an unresolvable scope from promoting a result in the wrong country", async () => {
    const { resolveWithin } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveWithin).mockRejectedValue(new Error("fetch failed"));

    mocks.geocodeAddress.mockResolvedValue({
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-77.489223, 39.081592] },
          properties: {
            type: "Street",
            address: { freeformAddress: "Mill Dam Place, Leesburg, VA", municipality: "Leesburg" },
          },
        },
      ],
    });
    mocks.poiSearch.mockResolvedValue({
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [4.89672, 52.37675] },
          properties: {
            type: "POI",
            poi: { name: "Penthouse Amsterdam Dam Square" },
            address: {
              freeformAddress: "Nieuwendijk 89, 1012 MC Amsterdam",
              municipality: "Amsterdam",
            },
          },
        },
      ],
    });

    const body = parse(
      await locatePlaceHandler({ query: "Dam Square, Amsterdam", show_ui: false } as never)
    );

    expect(body.located).toBe("Penthouse Amsterdam Dam Square");
    expect(body.matchNote).toContain("Nothing is named exactly");
  });

  // …but being in the named area must not outrank being NAMED it: the geocoder
  // returns Westminster as "Westminster", with no mention of London anywhere.
  it("still prefers an exact name match that does not echo the area", async () => {
    const { resolveWithin } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveWithin).mockRejectedValue(new Error("fetch failed"));

    mocks.geocodeAddress.mockResolvedValue({
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-0.1262362, 51.5001524] },
          properties: { type: "Geography", address: { freeformAddress: "Westminster" } },
        },
      ],
    });
    mocks.poiSearch.mockResolvedValue({
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-0.12709, 51.49327] },
          properties: {
            type: "POI",
            poi: { name: "The Westminster London" },
            address: { freeformAddress: "London", municipality: "London" },
          },
        },
      ],
    });

    const body = parse(
      await locatePlaceHandler({ query: "Westminster, London", show_ui: false } as never)
    );

    expect(body.located).toBe("Westminster");
  });

  // The second half of the same bug. `within` computed the bbox correctly and
  // then also sent its centre as `position`, which the geocoder prefers — so the
  // hard scope silently became a weak bias. Measured: bbox alone gives "Dam, 1012
  // Amsterdam"; bbox + centre gives "Beaver Dam Place, Zion Crossroads, VA".
  it('constrains a "within" scope by bounding box alone, with no position bias', async () => {
    const { resolveWithin } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveWithin).mockResolvedValue({
      value: [{ bbox: [4.7289, 52.278009, 5.107671, 52.431229], label: "Amsterdam" }],
    } as never);

    await locatePlaceHandler({
      query: "Dam Square",
      queryAs: "place",
      where: { mode: "within", queries: ["Amsterdam"] },
      show_ui: false,
    } as never);

    const options = mocks.geocodeAddress.mock.calls[0][1];
    expect(options.boundingBox).toEqual([4.7289, 52.278009, 5.107671, 52.431229]);
    expect(options).not.toHaveProperty("position");
  });

  it('still passes a position bias for a "nearby" scope', async () => {
    const { resolveNearby } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveNearby).mockResolvedValue({ value: { position: [4.9, 52.37] } } as never);

    await locatePlaceHandler({
      query: "Dam Square",
      queryAs: "place",
      where: { mode: "nearby", queries: ["Amsterdam"] },
      show_ui: false,
    } as never);

    const options = mocks.geocodeAddress.mock.calls[0][1];
    expect(options.position).toEqual([4.9, 52.37]);
    expect(options).not.toHaveProperty("boundingBox");
  });

  it("asks for several candidates so an ambiguous name can be reported", async () => {
    await locatePlaceHandler({ query: "Dam Square", queryAs: "poi", show_ui: false } as never);

    expect(mocks.poiSearch).toHaveBeenCalledWith(
      "Dam Square",
      expect.objectContaining({ limit: 5 })
    );
  });
});

describe("discoverPlacesHandler within multiple areas", () => {
  const station = (id: string) => ({
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates: [4.9, 52.37] },
    properties: { poi: { name: id } },
  });
  const collection = (...ids: string[]) => ({
    type: "FeatureCollection",
    properties: { numResults: ids.length },
    features: ids.map(station),
  });

  /** Four nested isochrone polygons, as `find-reachable-areas` produces. */
  const fourAreas = {
    value: [10, 20, 30, 40].map((minutes) => ({
      polygon: {
        type: "Polygon",
        coordinates: [
          [
            [4, 52],
            [5, 52],
            [5, 53],
            [4, 52],
          ],
        ],
      },
      label: `${minutes} min`,
    })),
  };

  const parse = (response: { content: { text: string }[] }) => JSON.parse(response.content[0].text);

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.storeDataset.mockReturnValue({ id: "ds_test" });
    const { resolveWithin, describeAreas } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveWithin).mockResolvedValue(fourAreas as never);
    vi.mocked(describeAreas).mockImplementation(((areas: { label?: string }[]) =>
      areas.map((a) => a.label).join(", ")) as never);
  });

  // The bug, as the capability benchmark found it: asked how many EV chargers
  // fall inside a 30-minute drive, the agent searched the first of four
  // isochrone polygons, got zero, and reported zero for the whole area.
  it("searches every resolved area, not just the first", async () => {
    mocks.searchInArea
      .mockResolvedValueOnce(collection())
      .mockResolvedValueOnce(collection("a"))
      .mockResolvedValueOnce(collection("b"))
      .mockResolvedValueOnce(collection("c"));

    const response = await discoverPlacesHandler({
      query: "EV charging",
      where: { mode: "within", dataset_ids: ["ds_reach"] },
      show_ui: false,
    } as never);

    expect(mocks.searchInArea).toHaveBeenCalledTimes(4);
    expect(parse(response).features).toHaveLength(3);
  });

  it("counts a place found in several nested areas once", async () => {
    mocks.searchInArea.mockResolvedValue(collection("shared", "also-shared"));

    const body = parse(
      await discoverPlacesHandler({
        query: "EV charging",
        where: { mode: "within", dataset_ids: ["ds_reach"] },
        show_ui: false,
      } as never)
    );

    // Four nested polygons each return the same two stations. Two, not eight.
    expect(body.features).toHaveLength(2);
    expect(body.searched.duplicatesMerged).toBe(6);
  });

  it("applies limit to the merged set, not to each area", async () => {
    mocks.searchInArea
      .mockResolvedValueOnce(collection("a", "b"))
      .mockResolvedValueOnce(collection("c", "d"))
      .mockResolvedValueOnce(collection("e", "f"))
      .mockResolvedValueOnce(collection("g", "h"));

    const body = parse(
      await discoverPlacesHandler({
        query: "EV charging",
        limit: 3,
        where: { mode: "within", dataset_ids: ["ds_reach"] },
        show_ui: false,
      } as never)
    );

    expect(body.features).toHaveLength(3);
  });

  it("returns what it could search and says so when one area fails", async () => {
    mocks.searchInArea
      .mockResolvedValueOnce(collection("a"))
      .mockRejectedValueOnce(new Error("bad polygon"))
      .mockResolvedValueOnce(collection("b"))
      .mockResolvedValueOnce(collection("c"));

    const body = parse(
      await discoverPlacesHandler({
        query: "EV charging",
        where: { mode: "within", dataset_ids: ["ds_reach"] },
        show_ui: false,
      } as never)
    );

    expect(body.features).toHaveLength(3);
    // A partial answer presented as complete is the failure being fixed here,
    // so a partial answer has to announce itself.
    expect(body.searched.note).toMatch(/1 of the resolved areas could not be searched/);
  });

  it("fails rather than returning nothing when every area fails", async () => {
    mocks.searchInArea.mockRejectedValue(new Error("upstream down"));

    const response = await discoverPlacesHandler({
      query: "EV charging",
      where: { mode: "within", dataset_ids: ["ds_reach"] },
      show_ui: false,
    } as never);

    expect(response.isError).toBe(true);
    // "No chargers here" and "the search broke" must never look the same.
    expect(response.content[0].text).toContain("upstream down");
  });
});
