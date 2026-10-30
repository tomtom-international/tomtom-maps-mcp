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
import { inNamedArea, normaliseName, rankLocateCandidates } from "./place-names";
import { splitNamedQuery } from "./resolve-where";

const recorded = loadFixture("landmarks");

describe("rankLocateCandidates on recorded answers", () => {
  it.each(LANDMARKS)("$query", ({ query, queryAs, at, withinMeters, knownWrong }) => {
    const { poi, geocode } = recorded[query];
    const { subject, area } = splitNamedQuery(query);

    const {
      ranked: [top],
    } = rankLocateCandidates<Place>([...poi.features, ...geocode.features], subject, {
      area,
      queryAs,
    });

    const metersOff = turf.distance(top.geometry.coordinates, at, { units: "meters" });
    if (knownWrong) expect(metersOff).toBeGreaterThan(withinMeters);
    else expect(metersOff).toBeLessThanOrEqual(withinMeters);
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
});
