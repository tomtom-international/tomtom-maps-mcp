/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { describe, expect, it } from "vitest";
import type { Feature, Polygon } from "geojson";
import geocode from "../../../tools/shared/__fixtures__/orbis-geocode.json";
import evSearch from "../../../tools/shared/__fixtures__/orbis-ev-search.json";
import reverseGeocode from "../../../tools/shared/__fixtures__/orbis-reverse-geocode.json";
import route from "../../../tools/shared/__fixtures__/orbis-route.json";
import { type ToolData, toMapContent } from "./mapContent";

const read = (data: unknown) => toMapContent(data as ToolData);

const BOUNDARY: Feature<Polygon> = {
  type: "Feature",
  properties: {},
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [4.8, 52.3],
        [5.0, 52.3],
        [5.0, 52.4],
        [4.8, 52.3],
      ],
    ],
  },
};

describe("toMapContent", () => {
  it("shows the places of a search", () => {
    expect(read(geocode)).toEqual({ places: geocode.features });
    expect(read(evSearch).places).toHaveLength(evSearch.features.length);
  });

  it("shows an area search's places with its boundary", () => {
    expect(read({ ...evSearch, _searchBoundary: BOUNDARY })).toEqual({
      places: evSearch.features,
      boundary: BOUNDARY,
    });
  });

  it("flies to a reverse-geocoded place, and shows nothing where no address is near", () => {
    expect(read(reverseGeocode)).toEqual({ places: [reverseGeocode], single: true });
    const noAddress = { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] } };
    expect(read(noAddress)).toEqual({ places: [], single: true });
  });

  it("shows a route", () => {
    expect(read(route)).toEqual({ places: [], routes: route });
  });

  it("shows search along route's route with the places along it", () => {
    expect(read({ route, pois: geocode })).toEqual({ places: geocode.features, routes: route });
    expect(read({ route, pois: { type: "FeatureCollection", features: [] } }).places).toEqual([]);
  });

  it("shows nothing for an empty result", () => {
    expect(read({ type: "FeatureCollection", features: [] })).toEqual({ places: [] });
  });
});
