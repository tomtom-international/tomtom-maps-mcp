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

import type { Position } from "geojson";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = {
  geocodeAddress: vi.fn(),
  geocodeAreas: vi.fn(),
  fetchBoundaries: vi.fn(),
  poiSearch: vi.fn(),
  fuzzySearch: vi.fn(),
  searchInAreas: vi.fn(),
  searchAlongRoute: vi.fn(),
  getRoute: vi.fn(),
};

vi.mock("../../services/search/searchService", () => ({
  geocodeAddress: mocks.geocodeAddress,
  geocodeAreas: mocks.geocodeAreas,
  fetchBoundaries: mocks.fetchBoundaries,
  hasBoundary: (place: { properties: { dataSources?: { geometry?: { id: string } } } }) =>
    Boolean(place.properties.dataSources?.geometry?.id),
  poiSearch: mocks.poiSearch,
  fuzzySearch: mocks.fuzzySearch,
  searchInAreas: mocks.searchInAreas,
  searchAlongRoute: mocks.searchAlongRoute,
  // Every category resolves except the word "xyzzy".
  resolveCategories: async (inputs: string[]) => ({
    poiCategories: inputs.filter((input) => input !== "xyzzy"),
    unmatched: inputs.filter((input) => input === "xyzzy"),
  }),
}));

vi.mock("../../services/routing/routingService", () => ({ getRoute: mocks.getRoute }));

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
    vi.clearAllMocks();
    const { resolveWithin } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveWithin).mockResolvedValue([
      {
        bbox: [4.7289, 52.278009, 5.107671, 52.431229],
        label: "Amsterdam",
        query: "Amsterdam",
        source: "query",
      },
    ]);
    mocks.searchInAreas.mockResolvedValue({ type: "FeatureCollection", features: [] });
  });

  it("sends an empty query, not a literal asterisk, when only categories are given", async () => {
    await discoverPlacesHandler({
      poiCategories: ["RESTAURANT"],
      where: { mode: "within", queries: ["Amsterdam"] },
    });

    expect(mocks.searchInAreas).toHaveBeenCalledWith(
      "",
      expect.anything(),
      expect.objectContaining({ poiCategories: ["RESTAURANT"] })
    );
  });

  it("searches an area without a boundary as its bounding rectangle", async () => {
    await discoverPlacesHandler({
      poiCategories: ["RESTAURANT"],
      where: { mode: "within", queries: ["Amsterdam"] },
    });

    const [[, [area]]] = mocks.searchInAreas.mock.calls;
    expect(area.type).toBe("Polygon");
    expect(area.coordinates[0]).toHaveLength(5);
    expect(area.coordinates[0]).toEqual(
      expect.arrayContaining([
        [4.7289, 52.278009],
        [5.107671, 52.431229],
      ])
    );
  });

  it("still passes the caller's free text when there is some", async () => {
    await discoverPlacesHandler({
      query: "italian",
      poiCategories: ["RESTAURANT"],
      where: { mode: "within", queries: ["Amsterdam"] },
    });

    expect(mocks.searchInAreas).toHaveBeenCalledWith(
      "italian",
      expect.anything(),
      expect.anything()
    );
  });

  it("reports the categories it could not resolve alongside the results", async () => {
    const response = await discoverPlacesHandler({
      poiCategories: ["RESTAURANT", "xyzzy"],
      where: { mode: "within", queries: ["Amsterdam"] },
    });

    expect(parse(response).searched).toMatchObject({
      poiCategories: ["RESTAURANT"],
      unresolvedCategories: ["xyzzy"],
    });
  });

  it("fails, naming the words, when no category resolves", async () => {
    const response = await discoverPlacesHandler({
      poiCategories: ["xyzzy"],
      where: { mode: "within", queries: ["Amsterdam"] },
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("xyzzy");
    expect(mocks.searchInAreas).not.toHaveBeenCalled();
  });
});

describe("locatePlaceHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("takes the queryAs index when every candidate is named after the place", async () => {
    // What the live indexes return: the geocoder's top hit is a street 7 km away.
    mocks.poiSearch.mockResolvedValue({
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [2.174, 41.403] },
          properties: {
            type: "POI",
            poi: { name: "Templo de la Sagrada Familia" },
            address: { municipality: "Barcelona" },
          },
        },
      ],
    });
    mocks.geocodeAddress.mockResolvedValue({
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [2.095, 41.42] },
          properties: {
            type: "Street",
            address: { freeformAddress: "Calle de la Sagrada Familia, Barcelona" },
          },
        },
      ],
    });

    const body = parse(
      await locatePlaceHandler({
        query: "Sagrada Família, Barcelona",
        queryAs: "poi",
        show_ui: false,
      } as never)
    );

    expect(body.located).toBe("Templo de la Sagrada Familia");
  });

  it("prefers candidates that stand together over scattered borrowed names", async () => {
    const poi = (name: string, coordinates: Position) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates },
      properties: { type: "POI", poi: { name } },
    });
    const street = (freeformAddress: string, coordinates: Position) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates },
      properties: { type: "Street", address: { freeformAddress } },
    });
    // What the live indexes return: none of the POIs is the tower.
    mocks.poiSearch.mockResolvedValue({
      features: [
        poi("Eiffel Tower París", [2.387, 48.832]),
        poi("Eiffel Tower Paris", [2.33, 48.885]),
        poi("Eiffel Tower Paris", [2.341, 48.849]),
      ],
    });
    mocks.geocodeAddress.mockResolvedValue({
      features: [
        street("Avenue Gustave Eiffel, 75007 Paris", [2.295, 48.8577]),
        street("Esplanade des Ouvriers de la Tour Eiffel, 75007 Paris", [2.294, 48.859]),
      ],
    });

    const body = parse(
      await locatePlaceHandler({
        query: "Eiffel Tower, Paris",
        queryAs: "poi",
        show_ui: false,
      } as never)
    );

    expect(body.located).toBe("Avenue Gustave Eiffel, 75007 Paris");
  });

  it("prefers a shortened name from the queryAs index over a generic geography", async () => {
    mocks.poiSearch.mockResolvedValue({
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [4.762, 52.31] },
          properties: { type: "POI", poi: { name: "Schiphol" } },
        },
      ],
    });
    mocks.geocodeAddress.mockResolvedValue({
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-90.382, 38.728] },
          properties: { type: "Geography", address: { freeformAddress: "Airport, MO" } },
        },
      ],
    });

    const body = parse(
      await locatePlaceHandler({
        query: "Schiphol Airport",
        queryAs: "poi",
        show_ui: false,
      } as never)
    );

    expect(body.located).toBe("Schiphol");
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
    vi.mocked(resolveWithin).mockResolvedValue([
      { bbox: [4.7289, 52.278009, 5.107671, 52.431229], label: "Amsterdam" },
    ] as never);

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
  // place-over-business rule above geography would put that US street ahead of
  // the hotel on the square — wrong in a way a user cannot see.
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
    vi.mocked(resolveWithin).mockResolvedValue([
      { bbox: [4.7289, 52.278009, 5.107671, 52.431229], label: "Amsterdam" },
    ] as never);

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
    vi.mocked(resolveNearby).mockResolvedValue({ position: [4.9, 52.37], radiusMeters: 1000 });

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

describe("discoverPlacesHandler scopes", () => {
  const square = {
    type: "Polygon" as const,
    coordinates: [
      [
        [4, 52],
        [5, 52],
        [5, 53],
        [4, 52],
      ],
    ],
  };
  const places = { type: "FeatureCollection", features: [] };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchInAreas.mockResolvedValue(places);
    mocks.fuzzySearch.mockResolvedValue(places);
    mocks.searchAlongRoute.mockResolvedValue(places);
  });

  it("searches every resolved area in ONE request, and says where each name resolved", async () => {
    const { resolveWithin } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveWithin).mockResolvedValue(
      ["Jordaan, Amsterdam", "Centrum, Utrecht"].map((label) => ({
        bbox: [4, 52, 5, 53] as [number, number, number, number],
        polygon: square,
        label,
        query: label.split(",")[0],
        source: "query" as const,
      }))
    );

    const response = await discoverPlacesHandler({
      query: "bakery",
      where: { mode: "within", queries: ["Jordaan", "Centrum"] },
    });

    expect(mocks.searchInAreas).toHaveBeenCalledTimes(1);
    expect(mocks.searchInAreas.mock.calls[0][1]).toEqual([square, square]);
    expect(parse(response).searched.resolvedAreas).toEqual([
      { query: "Jordaan", matched: "Jordaan, Amsterdam" },
      { query: "Centrum", matched: "Centrum, Utrecht" },
    ]);
  });

  it("biases a nearby search to the point and radius", async () => {
    const { resolveNearby } = await import("../shared/inputs/resolve-where");
    vi.mocked(resolveNearby).mockResolvedValue({ position: [4.9, 52.37], radiusMeters: 500 });

    await discoverPlacesHandler({
      query: "coffee",
      where: { mode: "nearby", query: "Dam Square, Amsterdam", radiusMeters: 500 },
    });

    expect(mocks.fuzzySearch).toHaveBeenCalledWith(
      "coffee",
      expect.objectContaining({ position: [4.9, 52.37], radius: 500 })
    );
  });

  it("plans the trip, then searches along it within the detour budget", async () => {
    const route = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [] },
      properties: { summary: { lengthInMeters: 520_000, travelTimeInSeconds: 18_000 } },
    };
    mocks.getRoute.mockResolvedValue({ type: "FeatureCollection", features: [route] });

    const response = await discoverPlacesHandler({
      poiCategories: ["ELECTRIC_VEHICLE_STATION"],
      where: {
        mode: "maxDetour",
        locations: [{ position: [4.9, 52.37] }, { position: [2.35, 48.86] }],
        maxDetourTimeSeconds: 600,
        sortBy: "detourOffset",
      },
    });

    expect(mocks.getRoute).toHaveBeenCalledWith([
      [4.9, 52.37],
      [2.35, 48.86],
    ]);
    expect(mocks.searchAlongRoute).toHaveBeenCalledWith(
      "",
      route,
      expect.objectContaining({ maxDetourTimeSeconds: 600, sortBy: "detourOffset" })
    );
    expect(parse(response).searched).toMatchObject({
      mode: "maxDetour",
      route: { lengthInMeters: 520_000, travelTimeInSeconds: 18_000 },
    });
  });

  it("rejects countries with an area, which already says where", async () => {
    const response = await discoverPlacesHandler({
      query: "bakery",
      countries: ["NL"],
      where: { mode: "within", boundingBox: [4, 52, 5, 53] },
    });

    expect(response.isError).toBe(true);
    expect(mocks.searchInAreas).not.toHaveBeenCalled();
  });

  it("fails loudly when the search breaks", async () => {
    mocks.fuzzySearch.mockRejectedValue(new Error("upstream down"));

    const response = await discoverPlacesHandler({ query: "EV charging" });

    expect(response.isError).toBe(true);
    // "No chargers here" and "the search broke" must never look the same.
    expect(response.content[0].text).toContain("upstream down");
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
  const jordaanArea = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        bbox: [4.87, 52.37, 4.89, 52.39],
        geometry: { type: "Point", coordinates: [4.88, 52.38] },
        properties: {
          type: "Geography",
          address: { freeformAddress: "Jordaan, Amsterdam" },
          dataSources: { geometry: { id: "b-1" } },
        },
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.poiSearch.mockResolvedValue(oneFeature("Café Jordaan, Amsterdam"));
    mocks.geocodeAddress.mockResolvedValue(oneFeature("Jordaanstraat, Amsterdam"));
    mocks.geocodeAreas.mockResolvedValue(jordaanArea);
    mocks.fetchBoundaries.mockResolvedValue({ features: [{ geometry: square }] });
  });

  it("returns the area's boundary polygon when geometry is asked for", async () => {
    const response = await locatePlaceHandler({
      query: "Jordaan",
      queryAs: "place",
      response_detail: "geometry",
    });
    const body = parse(response);

    expect(body.located).toBe("Jordaan, Amsterdam");
    expect(body.geometry.features).toHaveLength(1);
    expect(body.geometry.features[0]).toMatchObject({
      geometry: { type: "Polygon" },
      properties: { place: 0 },
    });
  });

  it("does not look for areas or boundaries when no geometry is asked for", async () => {
    const response = await locatePlaceHandler({ query: "Jordaan", queryAs: "place" });

    expect(mocks.geocodeAreas).not.toHaveBeenCalled();
    expect(mocks.fetchBoundaries).not.toHaveBeenCalled();
    expect(parse(response).features).toHaveLength(1);
  });

  it("says so, and returns the point, when the place has no boundary", async () => {
    mocks.geocodeAreas.mockResolvedValue({ type: "FeatureCollection", features: [] });

    const body = parse(
      await locatePlaceHandler({
        query: "Café Jordaan",
        queryAs: "poi",
        response_detail: "geometry",
      })
    );

    expect(body.boundaryNote).toContain("no boundary polygon");
    expect(body.geometry.features[0].geometry.type).toBe("Point");
  });
});
