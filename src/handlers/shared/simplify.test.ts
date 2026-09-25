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

import { describe, it, expect } from "vitest";
import type { Position } from "geojson";
import {
  VERTEX_CAP,
  PathSimplifier,
  anchorCount,
  capPaths,
  project,
  ringsAreValid,
  roundPosition,
} from "./simplify";

/** Deterministic pseudo-random numbers, so failures reproduce. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** A wandering road-like line of `n` points near Amsterdam. */
function randomWalk(n: number, seed = 1): Position[] {
  const random = seeded(seed);
  const line: Position[] = [[4.9, 52.37]];
  let heading = 0;
  for (let i = 1; i < n; i++) {
    heading += (random() - 0.5) * 0.6;
    const [x, y] = line[i - 1];
    line.push([x + Math.cos(heading) * 0.0004, y + Math.sin(heading) * 0.00025]);
  }
  return line;
}

/** Worst case for Douglas-Peucker: every vertex is a local extreme. */
const zigzag = (n: number): Position[] =>
  Array.from({ length: n }, (_, i) => [4 + i * 0.0001, 52 + (i % 2 ? 0.0003 : 0)]);

/**
 * Two interlocking combs with a narrow gap. Valid as given, but capping it
 * without a validity check cuts edges across the other comb's teeth.
 */
function zipper(teeth: number): Position[] {
  const w = 0.0004;
  const h = 0.0006;
  const gap = 0.0001;
  const H = 0.001;
  const y = 52;
  const x0 = 4.9;
  const bottom: Position[] = [];
  const topTeeth: Position[][] = [];
  for (let k = 0; k < teeth; k++) {
    const x = x0 + k * 2 * w;
    bottom.push(
      [x, y - H],
      [x + w, y - H],
      [x + 1.25 * w, y + h - gap],
      [x + 1.75 * w, y + h - gap]
    );
    topTeeth.push([
      [x + 2 * w, y + H],
      [x + w, y + H],
      [x + 0.75 * w, y - h + gap],
      [x + 0.25 * w, y - h + gap],
    ]);
  }
  const end = x0 + teeth * 2 * w;
  return [
    [x0, y - 2 * H],
    ...bottom,
    [end, y - H],
    [end, y - 2 * H],
    [end + w, y - 2 * H],
    [end + w, y + 2 * H],
    ...topTeeth.reverse().flat(),
    [x0, y + H],
    [x0 - w, y + 2 * H],
    [x0 - w, y - 2 * H],
    [x0, y - 2 * H],
  ];
}

/** Brute force: the largest distance, in metres, of any original vertex from the kept line. */
function bruteMaxError(original: Position[], kept: Position[]): number {
  const [xs, ys] = project(original);
  const keptIndexes = kept.map((p) => original.indexOf(p));
  let max = 0;
  for (let k = 0; k + 1 < keptIndexes.length; k++) {
    const a = keptIndexes[k];
    const b = keptIndexes[k + 1];
    const dx = xs[b] - xs[a];
    const dy = ys[b] - ys[a];
    const length2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      let t = length2 ? ((xs[i] - xs[a]) * dx + (ys[i] - ys[a]) * dy) / length2 : 0;
      t = Math.max(0, Math.min(1, t));
      max = Math.max(max, Math.hypot(xs[a] + t * dx - xs[i], ys[a] + t * dy - ys[i]));
    }
  }
  return max;
}

/** Brute force O(n²) check that no two non-adjacent edges of a ring cross. */
function bruteRingIsSimple(ring: Position[]): boolean {
  const n = ring.length - 1;
  const orient = (a: Position, b: Position, c: Position) =>
    Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [a, b, c, d] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
      if (orient(a, b, c) !== orient(a, b, d) && orient(c, d, a) !== orient(c, d, b)) {
        return false;
      }
    }
  }
  return true;
}

const decimals = (value: number) => (String(value).split(".")[1] ?? "").length;

describe("capPaths on lines", () => {
  it("only rounds a line at or below the cap", () => {
    const line = randomWalk(VERTEX_CAP);
    const result = capPaths([line], { rings: false });

    expect(result.simplification).toBeUndefined();
    expect(result.paths[0]).toEqual(line.map(roundPosition));
  });

  it("rounds coordinates to 5 decimals in [lon, lat] order", () => {
    const result = capPaths([[[4.123456789, 52.987654321]]], { rings: false });
    expect(result.paths[0]).toEqual([[4.12346, 52.98765]]);
    for (const [lon, lat] of capPaths([randomWalk(5000)], { rings: false }).paths[0]) {
      expect(decimals(lon)).toBeLessThanOrEqual(5);
      expect(decimals(lat)).toBeLessThanOrEqual(5);
    }
  });

  it.each([1001, 7577, 30000])("caps %i points at the vertex cap", (n) => {
    const line = randomWalk(n);
    const result = capPaths([line], { rings: false });

    expect(result.paths[0].length).toBeLessThanOrEqual(VERTEX_CAP);
    expect(result.simplification).toEqual({
      original_points: n,
      points: result.paths[0].length,
      max_error_m: expect.any(Number),
    });
  });

  it("keeps both endpoints", () => {
    const line = randomWalk(20000, 7);
    const [path] = capPaths([line], { rings: false }).paths;

    expect(path[0]).toEqual(roundPosition(line[0]));
    expect(path[path.length - 1]).toEqual(roundPosition(line[line.length - 1]));
  });

  it("pins evenly spaced anchors before inserting by error", () => {
    const line = randomWalk(10000, 3);
    const simplifier = new PathSimplifier(line, VERTEX_CAP);
    const anchors = anchorCount(VERTEX_CAP);

    expect(anchors).toBe(64);
    expect(simplifier.points).toBe(anchors + 1);
    const kept = simplifier.result();
    for (let k = 0; k <= anchors; k++) {
      expect(kept).toContain(line[Math.round((k * (line.length - 1)) / anchors)]);
    }
  });

  it.each([
    ["a wandering line", randomWalk(20000, 11)],
    ["a zigzag", zigzag(5000)],
  ])("reports max_error_m as the true maximum distance of a dropped vertex (%s)", (_, line) => {
    const simplifier = new PathSimplifier(line, VERTEX_CAP);
    simplifier.growTo(VERTEX_CAP);
    const truth = bruteMaxError(line, simplifier.result());

    expect(simplifier.maxErrorM).toBeCloseTo(truth, 6);
    expect(capPaths([line], { rings: false }).simplification?.max_error_m).toBe(Math.ceil(truth));
  });

  it("caps a 50,000-point zigzag well under 50 ms", () => {
    const line = zigzag(50000);
    capPaths([line], { rings: false }); // warm up the JIT
    // Best of up to ten runs: it takes about 5 ms, but a machine busy with the
    // rest of the suite can stall any single run. The work bound below is the
    // deterministic guard.
    let best = Infinity;
    for (let run = 0; run < 10 && best >= 50; run++) {
      const start = performance.now();
      const result = capPaths([line], { rings: false });
      best = Math.min(best, performance.now() - start);
      expect(result.paths[0].length).toBeLessThanOrEqual(VERTEX_CAP);
    }
    expect(best).toBeLessThan(50);
  });

  it("anchors bound the work on a zigzag, where plain Douglas-Peucker scans n × cap vertices", () => {
    // Measured: 772,143 vertex scans with 64 anchors, 49,449,501 without (the
    // unanchored run is too slow for a unit test). Machine-independent, unlike
    // the timing above.
    const anchored = new PathSimplifier(zigzag(50000), VERTEX_CAP);
    anchored.growTo(VERTEX_CAP);

    expect(anchored.work).toBeLessThan(1_000_000);
  });

  it("shares the cap between the parts of one feature", () => {
    const parts = [randomWalk(3000, 1), randomWalk(1000, 2)];
    const result = capPaths(parts, { rings: false });
    const points = result.paths.reduce((sum, path) => sum + path.length, 0);

    expect(points).toBeLessThanOrEqual(VERTEX_CAP);
    expect(result.paths[0].length).toBeGreaterThan(result.paths[1].length);
    expect(result.simplification?.original_points).toBe(4000);
  });
});

describe("capPaths on polygon rings", () => {
  it("keeps a simplified ring closed and valid", () => {
    const ring: Position[] = Array.from({ length: 8000 }, (_, i) => {
      const a = (i / 8000) * 2 * Math.PI;
      const r = 0.3 + 0.05 * Math.sin(a * 17);
      return [4.9 + r * Math.cos(a) * 1.6, 52.37 + r * Math.sin(a)];
    });
    ring.push(ring[0]);
    const [out] = capPaths([ring], { rings: true }).paths;

    expect(out.length).toBeLessThanOrEqual(VERTEX_CAP);
    expect(out[0]).toEqual(out[out.length - 1]);
    expect(bruteRingIsSimple(out)).toBe(true);
  });

  it("falls back to a less simplified ring when capping makes it self-intersect", () => {
    const ring = zipper(400);
    expect(bruteRingIsSimple(ring)).toBe(true);

    // Capping without the check produces crossing edges...
    const plain = new PathSimplifier(ring, VERTEX_CAP);
    plain.growTo(VERTEX_CAP);
    expect(bruteRingIsSimple(plain.result())).toBe(false);

    // ...so the result keeps more vertices than the cap, and stays valid.
    const result = capPaths([ring], { rings: true });
    const [out] = result.paths;
    expect(bruteRingIsSimple(out)).toBe(true);
    expect(out.length).toBeGreaterThan(VERTEX_CAP);
    expect(out.length).toBeLessThan(ring.length);
    expect(result.simplification).toEqual({
      original_points: ring.length,
      points: out.length,
      max_error_m: expect.any(Number),
    });
  });
});

describe("ringsAreValid", () => {
  const square: Position[] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0],
  ];

  it("accepts a simple ring and rejects a bow tie", () => {
    expect(ringsAreValid([square])).toBe(true);
    expect(
      ringsAreValid([
        [
          [0, 0],
          [1, 1],
          [1, 0],
          [0, 1],
          [0, 0],
        ],
      ])
    ).toBe(false);
  });

  it("rejects a ring that touches itself at a vertex", () => {
    const touching: Position[] = [
      [0, 0],
      [2, 0],
      [1, 1],
      [2, 2],
      [0, 2],
      [1, 1],
      [0, 0],
    ];
    expect(ringsAreValid([touching])).toBe(false);
  });

  it("rejects a hole that crosses its outer ring", () => {
    const hole: Position[] = [
      [0.5, 0.5],
      [1.5, 0.5],
      [1.5, 0.8],
      [0.5, 0.8],
      [0.5, 0.5],
    ];
    expect(ringsAreValid([square, hole])).toBe(false);
  });

  it("agrees with a brute-force check on the zipper", () => {
    expect(ringsAreValid([zipper(50)])).toBe(bruteRingIsSimple(zipper(50)));
  });
});
