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

import { randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type { Position } from "geojson";
import { describe, expect, it } from "vitest";
import { encodeAppData } from "./app-data";
import { roundPosition } from "./simplify";

const ROOM = 100_000;

const decode = (inline = "") => JSON.parse(gunzipSync(Buffer.from(inline, "base64")).toString());

/** A winding route of `n` points, about 90 m apart, the way the Routing API samples one. */
function route(n: number) {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  let heading = 0;
  const coordinates: Position[] = [[-9.13930123, 38.72230456]];
  for (let i = 1; i < n; i++) {
    heading += (random() - 0.5) * 0.4;
    const [lon, lat] = coordinates[i - 1];
    coordinates.push([lon + 0.0009 * Math.cos(heading), lat + 0.0006 * Math.sin(heading)]);
  }
  const section = (start: number, end: number) => ({ startPointIndex: start, endPointIndex: end });
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates },
        properties: {
          summary: { lengthInMeters: n * 90 },
          sections: {
            leg: [section(0, n - 1)],
            tunnel: [section(244, 247), section(12_001, 12_004)],
            traffic: [section(30_017, 30_400)],
          },
          progress: [{ pointIndex: 0 }, { pointIndex: 1_234 }, { pointIndex: n - 1 }],
        },
      },
    ],
  };
}

/** Every vertex index in the route's properties, with the position it points at. */
function indexedPositions(data: ReturnType<typeof route>): Position[] {
  const [feature] = data.features;
  const { sections, progress } = feature.properties;
  const indices = [
    ...Object.values(sections).flatMap((list) =>
      list.flatMap((s) => [s.startPointIndex, s.endPointIndex])
    ),
    ...progress.map((p) => p.pointIndex),
  ];
  return indices.map((index) => feature.geometry.coordinates[index]);
}

describe("encodeAppData", () => {
  it("inlines data that fits as it is", async () => {
    const data = route(500);

    const { inline, report } = await encodeAppData(data, ROOM, false);

    expect(decode(inline)).toEqual(data);
    expect(report).toEqual({
      delivery: "inline",
      json_chars: JSON.stringify(data).length,
      inline_chars: inline?.length,
      simplification: undefined,
    });
  });

  it("simplifies a long route until it fits, keeping every indexed vertex", async () => {
    const data = route(40_000);

    const { inline, report } = await encodeAppData(data, ROOM, false);

    expect(inline?.length).toBeLessThanOrEqual(ROOM);
    const fitted = decode(inline);
    expect(indexedPositions(fitted)).toEqual(indexedPositions(data).map(roundPosition));
    expect(fitted.features[0].properties.sections.leg[0]).toEqual({
      startPointIndex: 0,
      endPointIndex: fitted.features[0].geometry.coordinates.length - 1,
    });
    expect(report.delivery).toBe("inline");
    expect(report.simplification).toEqual({
      original_points: 40_000,
      points: fitted.features[0].geometry.coordinates.length,
      max_error_m: expect.any(Number),
    });
    expect(report.simplification?.points).toBeLessThan(40_000);
  });

  it("does not touch data it must draw exactly", async () => {
    const { inline, report } = await encodeAppData(route(40_000), ROOM, true);

    expect(inline).toBeUndefined();
    expect(report.delivery).toBe("too_large");
  });

  it("leaves data with no route line to be fetched when it can't fit", async () => {
    const { inline, report } = await encodeAppData(
      { blob: randomBytes(100_000).toString("hex") },
      ROOM,
      false
    );

    expect(inline).toBeUndefined();
    expect(report).toEqual({ delivery: "too_large", json_chars: 200_011 });
  });
});
