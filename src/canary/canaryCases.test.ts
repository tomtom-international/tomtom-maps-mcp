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

import { describe, expect, it } from "vitest";
import { CANARY_CASES, type CanaryCase } from "./canaryCases";

const caseFor = (tool: string): CanaryCase => {
  const found = CANARY_CASES.find((canaryCase) => canaryCase.tool === tool);
  if (!found) throw new Error(`No canary case calls ${tool}`);
  return found;
};

const place = (coordinates: [number, number], countryCode = "NL") => ({
  type: "Feature",
  geometry: { type: "Point", coordinates },
  properties: { address: { countryCode } },
});

const route = (lengthInMeters: number) => ({
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: { summary: { lengthInMeters } } }],
});

describe("CANARY_CASES", () => {
  it("calls one tool per upstream it watches", () => {
    expect(CANARY_CASES.map((canaryCase) => canaryCase.tool)).toEqual([
      "tomtom-geocode",
      "tomtom-reverse-geocode",
      "tomtom-fuzzy-search",
      "tomtom-poi-categories",
      "tomtom-routing",
      "tomtom-traffic",
    ]);
  });

  it.each<[string, unknown, string[]]>([
    ["tomtom-geocode", { type: "FeatureCollection", features: [place([4.9003, 52.3789])] }, []],
    [
      "tomtom-geocode",
      { type: "FeatureCollection", features: [place([4.92, 52.3789])] },
      ["first result is 1337 m from Amsterdam Centraal, over 1000 m"],
    ],
    ["tomtom-geocode", { type: "FeatureCollection", features: [] }, ["no results"]],
    ["tomtom-reverse-geocode", place([4.9003, 52.3789]), []],
    ["tomtom-reverse-geocode", place([4.9003, 52.3789], "BE"), ["country is BE, not NL"]],
    ["tomtom-reverse-geocode", { type: "Feature", properties: {} }, ["country is missing, not NL"]],
    ["tomtom-fuzzy-search", { type: "FeatureCollection", features: [place([4.9, 52.37])] }, []],
    ["tomtom-fuzzy-search", { type: "FeatureCollection", features: [] }, ["no results"]],
    ["tomtom-poi-categories", { poiCategories: [{ code: "PARKING_GARAGE" }] }, []],
    ["tomtom-poi-categories", { poiCategories: [] }, ["no categories"]],
    ["tomtom-routing", route(45_000), []],
    ["tomtom-routing", route(12_000), ["route is 12 km, outside 30-60 km"]],
    ["tomtom-routing", { features: [] }, ["route is missing km, outside 30-60 km"]],
    ["tomtom-traffic", { incidents: [] }, []],
    ["tomtom-traffic", {}, ["no incidents list"]],
  ])("checks the %s result", (tool, data, failures) => {
    expect(caseFor(tool).check(data)).toEqual(failures);
  });
});
