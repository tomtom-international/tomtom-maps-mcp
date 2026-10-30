/*
 * Copyright (C) 2026 TomTom Navigation B.V.
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

import type { Place } from "@tomtom-org/maps-sdk/core";
import * as turf from "@turf/turf";
import { describe, expect, it } from "vitest";
import { loadFixture } from "../__fixtures__";
import { LANDMARKS } from "../__fixtures__/landmarks";
import { inNamedArea, normaliseName, rankPlaceCandidates } from "./place-names";
import { splitNamedQuery } from "./resolve-where";

const recorded = loadFixture("landmarks");

describe("rankPlaceCandidates on recorded answers", () => {
  it.each(LANDMARKS)("$query", ({ query, at, withinMeters }) => {
    const { subject, area } = splitNamedQuery(query);

    const {
      ranked: [top],
    } = rankPlaceCandidates<Place>(recorded[query].features, subject, { area });

    expect(turf.distance(top.geometry.coordinates, at, { units: "meters" })).toBeLessThanOrEqual(
      withinMeters
    );
  });
});

describe("rankPlaceCandidates", () => {
  const place = (name: string, municipality: string, boundary = false) =>
    ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: {
        poi: { name },
        address: { municipality },
        ...(boundary && { dataSources: { geometry: { id: "g" } } }),
      },
    }) as unknown as Place;
  const names = (ranked: Place[]) =>
    ranked.map((p) => `${p.properties.poi?.name}@${p.properties.address?.municipality}`);

  it("keeps the provider's order when nothing outranks it", () => {
    const { ranked, matchedByName } = rankPlaceCandidates(
      [place("Frankfurt am Main", "Frankfurt"), place("Frankfurt", "Billund")],
      "Frankfurt"
    );
    expect(names(ranked)).toEqual(["Frankfurt am Main@Frankfurt", "Frankfurt@Billund"]);
    expect(matchedByName).toBe(false);
  });

  it("puts a candidate in the named area first", () => {
    const { ranked } = rankPlaceCandidates(
      [place("Dam Square", "Zeist"), place("Penthouse Dam Square", "Amsterdam")],
      "Dam Square",
      { area: "Amsterdam" }
    );
    expect(names(ranked)[0]).toBe("Penthouse Dam Square@Amsterdam");
  });

  it("prefers the exact name within the named area", () => {
    const { ranked, matchedByName, exactMatches } = rankPlaceCandidates(
      [
        place("Alexanderplatz Christmas Market", "Berlin"),
        place("Alexanderplatz", "Berlin"),
        place("Alexanderplatz", "Zurich"),
      ],
      "Alexanderplatz",
      { area: "Berlin" }
    );
    expect(names(ranked)).toEqual([
      "Alexanderplatz@Berlin",
      "Alexanderplatz Christmas Market@Berlin",
      "Alexanderplatz@Zurich",
    ]);
    expect(matchedByName).toBe(true);
    expect(exactMatches).toBe(2);
  });

  it("puts a candidate with a boundary first when one is wanted", () => {
    const { ranked } = rankPlaceCandidates(
      [place("Jordaan", "Amsterdam"), place("De Jordaan", "Amsterdam", true)],
      "Jordaan",
      { area: "Amsterdam", boundaryWanted: true }
    );
    expect(names(ranked)[0]).toBe("De Jordaan@Amsterdam");
  });
});

describe("normaliseName", () => {
  it("ignores case, accents and punctuation", () => {
    expect(normaliseName("Sagrada Família")).toBe(normaliseName("sagrada-familia"));
    expect(normaliseName("Notre-Dame de Paris")).toBe("notre dame de paris");
  });
});

describe("inNamedArea", () => {
  const place = (address: Record<string, string>) =>
    ({ properties: { address } }) as unknown as Place;

  it("reads the area off the address", () => {
    expect(inNamedArea(place({ municipality: "Amsterdam" }), "Amsterdam")).toBe(true);
    expect(inNamedArea(place({ freeformAddress: "Leesburg, VA" }), "Amsterdam")).toBe(false);
  });

  it("does not hold a place without an address against the area", () => {
    expect(inNamedArea(place({}), "Amsterdam")).toBe(true);
  });

  it("matches the area as whole words, not inside another name", () => {
    expect(inNamedArea(place({ freeformAddress: "Venice, Italy" }), "Nice")).toBe(false);
    expect(inNamedArea(place({ country: "Sweden" }), "Ede")).toBe(false);
    expect(inNamedArea(place({ freeformAddress: "Promenade, 06000 Nice" }), "Nice")).toBe(true);
    expect(inNamedArea(place({ municipality: "Den Haag" }), "den haag")).toBe(true);
  });

  it("matches a country by its English name and its codes, whatever language labels it", () => {
    const merano = place({ municipality: "Merano", country: "Italia", countryCode: "IT" });
    expect(inNamedArea(merano, "Italy")).toBe(true);
    expect(inNamedArea(merano, "IT")).toBe(true);
    expect(inNamedArea(merano, "France")).toBe(false);
  });
});
