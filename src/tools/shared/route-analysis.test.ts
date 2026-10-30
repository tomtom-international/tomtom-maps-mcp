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

import type { Route, Routes, SectionsProps } from "@tomtom-org/maps-sdk/core";
import type { Position } from "geojson";
import { describe, expect, it } from "vitest";
import {
  analyzeRoutes,
  compareWithUsualRoute,
  positionAtCheckpoint,
  withSectionProgress,
} from "./route-analysis";

/** About 0.01° of longitude at the equator, as the SDK measures it along the geometry. */
const SEGMENT_METERS = 1112;

/** A route over `coordinates`, SEGMENT_METERS and a minute per segment. */
function route(coordinates: Position[], sections: Partial<SectionsProps>): Route {
  const last = coordinates.length - 1;
  const summary = {
    lengthInMeters: last * SEGMENT_METERS,
    travelTimeInSeconds: last * 60,
    trafficDelayInSeconds: 0,
    trafficLengthInMeters: 0,
    departureTime: new Date("2030-01-01T08:00:00Z"),
    arrivalTime: new Date("2030-01-01T08:04:00Z"),
  };
  return {
    type: "Feature",
    id: "route",
    bbox: [0, 0, 0, 0],
    geometry: { type: "LineString", coordinates },
    properties: {
      index: 0,
      summary,
      sections: {
        leg: [{ id: "leg", startPointIndex: 0, endPointIndex: last, summary }],
        ...sections,
      },
      progress: coordinates.map((_, pointIndex) => ({
        pointIndex,
        distanceInMeters: pointIndex * SEGMENT_METERS,
        travelTimeInSeconds: pointIndex * 60,
      })),
    },
  };
}

const routes = (...features: Route[]): Routes => ({ type: "FeatureCollection", features });

const span = (id: string, startPointIndex: number, endPointIndex: number) => ({
  id,
  startPointIndex,
  endPointIndex,
});

const curve = (
  id: string,
  index: number,
  headingChangeInDegrees: number,
  radiusInMeters: number
) => ({
  ...span(id, index, index + 1),
  headingChangeInDegrees,
  radiusInMeters,
  lengthInMeters: 100,
  curvinessScore: 200,
  severity: radiusInMeters < 50 ? 0.8 : 0.1,
});

const STRAIGHT: Position[] = [
  [0, 0],
  [0.01, 0],
  [0.02, 0],
  [0.03, 0],
  [0.04, 0],
];
const DETOUR: Position[] = [
  [0, 0],
  [0.01, 0.01],
  [0.02, 0.01],
  [0.03, 0.01],
  [0.04, 0],
];

const first = route(STRAIGHT, {
  country: [
    { ...span("c1", 0, 2), countryCodeISO2: "NL", countryCodeISO3: "NLD" },
    { ...span("c2", 2, 4), countryCodeISO2: "BE", countryCodeISO3: "BEL" },
  ],
  tollRoad: [span("t1", 3, 4)],
  importantRoadStretch: [{ ...span("i1", 0, 4), index: 0, roadNumbers: ["E19"] }],
  curve: [curve("k1", 1, 170, 20), curve("k2", 2, 60, 200)],
  curvyStretch: [
    {
      ...span("s1", 1, 3),
      curveCount: 2,
      hairpinCount: 1,
      lengthInMeters: 2000,
      minRadiusInMeters: 20,
      curvinessScore: 400,
    },
  ],
});

const detour = route(DETOUR, {
  importantRoadStretch: [{ ...span("i2", 0, 4), index: 0, roadNumbers: ["N1"] }],
  traffic: [
    {
      ...span("j1", 1, 3),
      categories: ["road-closed"],
      magnitudeOfDelay: "major",
      delayInSeconds: 300,
    },
  ],
});

describe("analyzeRoutes", () => {
  const [analysis, alternative] = analyzeRoutes(routes(first, detour));

  it("lists each country crossing in driving order, with its toll roads", () => {
    expect(analysis.countries).toEqual([
      {
        countryCodeISO3: "NLD",
        startsAfterMeters: 0,
        lengthInMeters: 2224,
        travelTimeInSeconds: 120,
      },
      {
        countryCodeISO3: "BEL",
        startsAfterMeters: 2224,
        lengthInMeters: 2224,
        travelTimeInSeconds: 120,
        tollRoadLengthInMeters: 1112,
      },
    ]);
  });

  it("names the main roads", () => {
    expect(analysis.roads).toEqual([{ name: "E19", lengthInMeters: 4448 }]);
  });

  it("reads the roads from the road shields, which cover the whole route", () => {
    const shielded = route(STRAIGHT, {
      roadShields: [
        {
          ...span("r1", 0, 1),
          roadShieldReferences: [{ reference: "global-fallback", shieldContent: "s100" }],
        },
        {
          ...span("r2", 1, 2),
          roadShieldReferences: [{ reference: "nld-highway", shieldContent: "A16" }],
        },
        {
          ...span("r3", 2, 3),
          roadShieldReferences: [
            { reference: "european-road", shieldContent: "E19" },
            { reference: "nld-highway", shieldContent: "A16" },
          ],
        },
        {
          ...span("r4", 3, 4),
          roadShieldReferences: [
            { reference: "deu-motorway", shieldContent: "3" },
            { reference: "european-road", shieldContent: "E35" },
          ],
        },
      ],
      importantRoadStretch: [{ ...span("i3", 3, 4), index: 0, roadNumbers: ["A3", "E35"] }],
    });
    expect(analyzeRoutes(routes(shielded))[0].roads).toEqual([
      { name: "A16", shield: "nld-highway", lengthInMeters: 2224 },
      { name: "3", shield: "deu-motorway", lengthInMeters: 1112 },
    ]);
  });

  it("counts curves, hairpins and hard curves, and places the curviest stretch", () => {
    expect(analysis.curvature).toMatchObject({
      curveCount: 2,
      hairpinCount: 1,
      hardCurveCount: 1,
      curvinessScore: 400,
      curvyStretchCount: 1,
      curviestStretches: [
        { startsAfterMeters: 1112, road: "E19", hairpinCount: 1, startPosition: [0.01, 0] },
      ],
    });
    expect(alternative.curvature).toBeUndefined();
  });

  it("names the first jam's distance and delay, and says when there is none", () => {
    expect(alternative.traffic).toEqual({
      delayInSeconds: 0,
      jamCount: 1,
      firstJam: {
        startsAfterMeters: 1112,
        lengthInMeters: 2224,
        delayInSeconds: 300,
        magnitudeOfDelay: "major",
        categories: ["road-closed"],
      },
    });
    expect(analysis.traffic).toEqual({ delayInSeconds: 0, jamCount: 0 });
  });

  it("compares each alternative with the first route, and only the alternatives", () => {
    expect(analysis.comparedToFirstRoute).toBeUndefined();
    expect(alternative.comparedToFirstRoute).toMatchObject({
      sameRoads: false,
      ownRoads: ["N1"],
      otherRouteOwnRoads: ["E19"],
      adds: { traffic: { count: 1, delayInSeconds: 300, closures: 1 } },
      avoids: { tollRoad: { count: 1 }, curve: { count: 2, hairpins: 1 } },
    });
  });
});

describe("compareWithUsualRoute", () => {
  it("reports the closures the live route goes around", () => {
    expect(compareWithUsualRoute(first, detour)).toMatchObject({
      sameRoads: false,
      liveRouteAvoids: { traffic: { closures: 1 } },
      avoidedIncidents: [{ categories: ["road-closed"], delayInSeconds: 300 }],
    });
  });

  it("says when traffic did not change the route", () => {
    expect(compareWithUsualRoute(first, first)).toMatchObject({
      sameRoads: true,
      avoidedIncidents: [],
    });
  });
});

describe("withSectionProgress", () => {
  const [withProgress] = withSectionProgress(routes(detour)).features;

  it("says where each section starts and how far and long it runs", () => {
    expect(withProgress.properties.sections.traffic?.[0]).toMatchObject({
      startsAfterMeters: 1112,
      lengthInMeters: 2224,
      travelTimeInSeconds: 120,
    });
  });

  it("leaves the legs, which carry their own summary", () => {
    expect(withProgress.properties.sections.leg[0]).not.toHaveProperty("startsAfterMeters");
  });

  it("does not change the routes it copies", () => {
    expect(detour.properties.sections.traffic?.[0]).not.toHaveProperty("startsAfterMeters");
  });
});

describe("positionAtCheckpoint", () => {
  it("finds the position after a driving time or distance", () => {
    expect(positionAtCheckpoint(first, { afterMinutes: 2 })).toMatchObject({
      position: [0.02, 0],
      distanceFromStartInMeters: 2224,
    });
    expect(positionAtCheckpoint(first, { afterKilometers: 3.336 })).toMatchObject({
      position: [0.03, 0],
      travelTimeFromStartInSeconds: 180,
    });
  });

  it("returns nothing past the end of the route", () => {
    expect(positionAtCheckpoint(first, { afterMinutes: 5 })).toBeUndefined();
  });
});
