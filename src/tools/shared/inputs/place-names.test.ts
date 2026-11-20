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
import {
  inNamedArea,
  isCountryName,
  lostAreaWords,
  normaliseName,
  rankPlaceCandidates,
} from "./place-names";
import { splitNamedQuery } from "./resolve-where";

const recorded = loadFixture("landmarks");

describe("rankPlaceCandidates on recorded answers", () => {
  it.each(LANDMARKS)("$query", ({ query, at, withinMeters }) => {
    const { subject, area } = splitNamedQuery(query);

    const {
      ranked: [top],
    } = rankPlaceCandidates<Place>(recorded[query].features, subject, area);

    expect(turf.distance(top.geometry.coordinates, at, { units: "meters" })).toBeLessThanOrEqual(
      withinMeters
    );
  });
});

describe("rankPlaceCandidates", () => {
  const place = (name: string, municipality: string) =>
    ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: { poi: { name }, address: { municipality } },
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
      "Amsterdam"
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
      "Berlin"
    );
    expect(names(ranked)).toEqual([
      "Alexanderplatz@Berlin",
      "Alexanderplatz Christmas Market@Berlin",
      "Alexanderplatz@Zurich",
    ]);
    expect(matchedByName).toBe(true);
    expect(exactMatches).toBe(2);
  });

  it("names an area by the first part of its label", () => {
    const paris = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-95.55, 33.66] },
      properties: {
        type: "Geography",
        address: {
          freeformAddress: "Paris, TX",
          countrySubdivisionName: "Texas",
          countryCode: "US",
        },
      },
    } as unknown as Place;
    const { ranked, matchedByName } = rankPlaceCandidates(
      [place("Eiffel Tower Paris Texas", "Paris"), paris],
      "Paris",
      "Texas"
    );
    expect(ranked[0]).toBe(paris);
    expect(matchedByName).toBe(true);
  });

  it("matches a name written with or without a leading article", () => {
    const { ranked, matchedByName } = rankPlaceCandidates(
      [place("The Pearl of The Jordaan", "Amsterdam"), place("Jordaan", "Amsterdam")],
      "the Jordaan",
      "Amsterdam"
    );
    expect(names(ranked)[0]).toBe("Jordaan@Amsterdam");
    expect(matchedByName).toBe(true);
  });

  it("breaks an equal score for the candidate with contact details, and only an equal score", () => {
    const scored = (name: string, score: number, url?: string) => {
      const candidate = place(name, "Amsterdam");
      Object.assign(candidate.properties, { score });
      Object.assign(candidate.properties.poi ?? {}, url && { url });
      return candidate;
    };
    const venue = (ranked: Place[]) => ranked.map((p) => p.properties.poi?.url ?? "-");

    const tied = rankPlaceCandidates(
      [scored("Westerkerk", 3.8), scored("Westerkerk", 3.8, "church")],
      "Westerkerk",
      "Amsterdam"
    );
    const apart = rankPlaceCandidates(
      [scored("Westerkerk", 3.9), scored("Westerkerk", 3.8, "church")],
      "Westerkerk",
      "Amsterdam"
    );

    expect(venue(tied.ranked)).toEqual(["church", "-"]);
    expect(venue(apart.ranked)).toEqual(["-", "church"]);
  });

  const labelled = (freeformAddress: string, extra: object = {}) =>
    ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: { type: "Geography", address: { freeformAddress }, ...extra },
    }) as unknown as Place;
  const labels = (ranked: Place[]) => ranked.map((p) => p.properties.address?.freeformAddress);

  it("puts a country called what was asked before a town the search ranked first", () => {
    const { ranked } = rankPlaceCandidates(
      [labelled("Greece, NY"), labelled("Greece", { geographyType: ["Country"] })],
      "Greece"
    );
    expect(labels(ranked)).toEqual(["Greece", "Greece, NY"]);
  });

  it("names a place the search labels with where it is, in brackets", () => {
    for (const [label, subject] of [
      ["Utrecht (NL)", "Utrecht"],
      ["Bristol (England)", "Bristol"],
      ["Manchester (GB, England, Greater Manchester)", "Manchester"],
    ]) {
      expect(rankPlaceCandidates([labelled(label)], subject).matchedByName).toBe(true);
    }
  });

  it("counts a name asked for abbreviated as matched, reordering nothing", () => {
    const venueInLondon = place("Baker Street", "London");
    const streetInOntario = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: { type: "Street", address: { freeformAddress: "Baker Street, London ON" } },
    } as unknown as Place;

    const { ranked, matchedByName, exactMatches } = rankPlaceCandidates(
      [venueInLondon, streetInOntario],
      "Baker St",
      "London"
    );

    expect(ranked).toEqual([venueInLondon, streetInOntario]);
    expect(matchedByName).toBe(true);
    expect(exactMatches).toBe(0);
  });

  it("abbreviates word for word, and a house number only by itself", () => {
    const matched = (label: string, subject: string) =>
      rankPlaceCandidates([labelled(label)], subject).matchedByName;

    expect(
      matched("1600 Pennsylvania Avenue Northwest, Washington", "1600 Pennsylvania Ave NW")
    ).toBe(true);
    expect(matched("Oxford Street East, London", "Oxford St")).toBe(false);
    expect(matched("Oxford Avenue, London", "Oxford St")).toBe(false);
    expect(matched("11 Downing Street, London", "10 Downing St")).toBe(false);
    expect(matched("11 Downing Street, London", "1 Downing St")).toBe(false);
  });
});

describe("isCountryName", () => {
  it("knows a country by its English name, in any case or accent", () => {
    expect(isCountryName("Malta")).toBe(true);
    expect(isCountryName("lebanon")).toBe(true);
    expect(isCountryName("El Salvador")).toBe(true);
    expect(isCountryName("Perú")).toBe(true);
  });

  it("knows no town, region or code as a country", () => {
    expect(isCountryName("Frankfurt")).toBe(false);
    expect(isCountryName("Texas")).toBe(false);
    expect(isCountryName("MT")).toBe(false);
  });
});

describe("lostAreaWords", () => {
  const area = (freeformAddress: string) =>
    ({ properties: { address: { freeformAddress } } }) as unknown as Place;

  it("names the words lost by candidates that kept only the generic ones", () => {
    expect(lostAreaWords("Utrecht city centre", [area("Sun City Center, FL")])).toEqual([
      "utrecht",
    ]);
  });

  it("finds nothing lost when a candidate carries the name", () => {
    expect(lostAreaWords("Utrecht city centre", [area("Utrecht")])).toBeUndefined();
    expect(lostAreaWords("Rotterdam city", [area("Rotterdam")])).toBeUndefined();
  });

  it("finds nothing lost when the candidates kept no word at all", () => {
    expect(lostAreaWords("Old Town, Prague", [area("Staré Město, Praha")])).toBeUndefined();
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

  it("matches each part of an area in several parts, in whatever order the address has them", () => {
    const dam = place({
      freeformAddress: "Dam 1, 1012 JS Amsterdam",
      municipality: "Amsterdam",
      country: "Nederland",
      countryCode: "NL",
    });
    expect(inNamedArea(dam, "Amsterdam, NL")).toBe(true);
    expect(inNamedArea(dam, "Amsterdam, Netherlands")).toBe(true);
    expect(inNamedArea(dam, "Rotterdam, NL")).toBe(false);
  });

  it("matches a state or province and a country's common alias", () => {
    const paris = place({
      freeformAddress: "Paris, TX",
      countrySubdivisionName: "Texas",
      countryCode: "US",
    });
    expect(inNamedArea(paris, "Texas")).toBe(true);
    expect(inNamedArea(paris, "Texas, USA")).toBe(true);
    expect(inNamedArea(paris, "Ontario")).toBe(false);
    const london = place({ freeformAddress: "London", countryCode: "GB" });
    expect(inNamedArea(london, "UK")).toBe(true);
    expect(inNamedArea(london, "United Kingdom")).toBe(true);
    const amsterdam = place({ freeformAddress: "Amsterdam", countryCode: "NL" });
    expect(inNamedArea(amsterdam, "Netherlands")).toBe(true);
    expect(inNamedArea(amsterdam, "Holland")).toBe(true);
    expect(inNamedArea(place({ freeformAddress: "Somewhere" }), "UK")).toBe(false);
  });
});
