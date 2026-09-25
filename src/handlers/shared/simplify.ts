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

// Vertex cap for response_detail "geometry" (docs/adr/0005-vertex-cap-simplification.md).
// Priority-driven Douglas-Peucker: start from the endpoints plus evenly spaced
// anchors, then repeatedly insert the dropped vertex with the largest
// perpendicular error until the cap is reached. Error is measured in metres in
// a local equirectangular projection.

import type { Position } from "geojson";

/** Maximum vertices per geometry feature. A server constant, not a caller parameter. */
export const VERTEX_CAP = 1000;

/** Anchors bound the worst case: no segment scan spans more than ~n / anchors vertices. */
export const anchorCount = (cap: number): number => Math.min(64, Math.floor(cap / 8));

const EARTH_RADIUS_M = 6371008.8;
const DEG = Math.PI / 180;

/** Rounds to 5 decimal places (about 1.1 m). */
export const roundCoord = (value: number): number => Math.round(value * 1e5) / 1e5;

export const roundPosition = (p: Position): Position => [roundCoord(p[0]), roundCoord(p[1])];

interface Segment {
  error: number;
  start: number;
  end: number;
  farthest: number;
}

class SegmentHeap {
  private items: Segment[] = [];

  get size(): number {
    return this.items.length;
  }

  peek(): Segment | undefined {
    return this.items[0];
  }

  push(segment: Segment): void {
    const items = this.items;
    items.push(segment);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].error >= items[i].error) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop(): Segment | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length && last) {
      items[0] = last;
      this.siftDown();
    }
    return top;
  }

  private siftDown(): void {
    const items = this.items;
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let largest = i;
      if (left < items.length && items[left].error > items[largest].error) largest = left;
      if (right < items.length && items[right].error > items[largest].error) largest = right;
      if (largest === i) return;
      [items[largest], items[i]] = [items[i], items[largest]];
      i = largest;
    }
  }
}

/**
 * Incremental priority-driven Douglas-Peucker over one path (a line or a closed ring).
 * `growTo` can be called again with a larger target, which the polygon fallback uses.
 */
export class PathSimplifier {
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  private readonly keep: Uint8Array;
  private readonly heap = new SegmentHeap();
  private kept = 0;
  private scanned = 0;

  constructor(
    private readonly coords: Position[],
    cap: number = VERTEX_CAP
  ) {
    const n = coords.length;
    this.keep = new Uint8Array(n);
    [this.xs, this.ys] = project(coords);
    if (n <= 2) {
      this.keep.fill(1);
      this.kept = n;
      return;
    }
    this.keep[0] = 1;
    this.keep[n - 1] = 1;
    this.kept = 2;

    const anchors = anchorCount(cap);
    let last = 0;
    for (let k = 1; k < anchors; k++) {
      const i = Math.round((k * (n - 1)) / anchors);
      if (i > last && i < n - 1) {
        this.keep[i] = 1;
        this.kept++;
        this.addSegment(last, i);
        last = i;
      }
    }
    this.addSegment(last, n - 1);
  }

  get points(): number {
    return this.kept;
  }

  /** Vertices scanned for their error so far: the algorithm's work, independent of the machine. */
  get work(): number {
    return this.scanned;
  }

  get complete(): boolean {
    return this.heap.size === 0;
  }

  /** Largest perpendicular distance, in metres, of any dropped vertex from the kept line. */
  get maxErrorM(): number {
    return this.heap.peek()?.error ?? 0;
  }

  growTo(target: number): void {
    while (this.kept < target) {
      const segment = this.heap.pop();
      if (!segment) return;
      this.keep[segment.farthest] = 1;
      this.kept++;
      this.addSegment(segment.start, segment.farthest);
      this.addSegment(segment.farthest, segment.end);
    }
  }

  result(): Position[] {
    const out: Position[] = [];
    for (let i = 0; i < this.coords.length; i++) {
      if (this.keep[i]) out.push(this.coords[i]);
    }
    return out;
  }

  private addSegment(start: number, end: number): void {
    if (end - start < 2) return;
    this.scanned += end - start - 1;
    const { xs, ys } = this;
    const ax = xs[start];
    const ay = ys[start];
    const dx = xs[end] - ax;
    const dy = ys[end] - ay;
    const length2 = dx * dx + dy * dy;
    let best = -1;
    let farthest = start + 1;
    for (let i = start + 1; i < end; i++) {
      let t = length2 ? ((xs[i] - ax) * dx + (ys[i] - ay) * dy) / length2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + t * dx - xs[i];
      const ey = ay + t * dy - ys[i];
      const d2 = ex * ex + ey * ey;
      if (d2 > best) {
        best = d2;
        farthest = i;
      }
    }
    this.heap.push({ error: Math.sqrt(best), start, end, farthest });
  }
}

/** Local equirectangular projection to metres, centred on the mean latitude. */
export function project(coords: Position[]): [Float64Array, Float64Array] {
  const n = coords.length;
  let latSum = 0;
  for (const c of coords) latSum += c[1];
  const k = n ? Math.cos((latSum / n) * DEG) : 1;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = coords[i][0] * DEG * EARTH_RADIUS_M * k;
    ys[i] = coords[i][1] * DEG * EARTH_RADIUS_M;
  }
  return [xs, ys];
}

/** Rounds every position and drops consecutive duplicates that rounding creates. */
function roundPath(path: Position[]): Position[] {
  const out: Position[] = [];
  for (const p of path) {
    const r = roundPosition(p);
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== r[0] || prev[1] !== r[1]) out.push(r);
  }
  return out;
}

export interface SimplifiedPaths {
  paths: Position[][];
  /** Present only when the input exceeded the cap. */
  simplification?: { original_points: number; points: number; max_error_m: number };
}

/**
 * Caps the total vertex count of a feature's paths (one line, or the rings of a
 * polygon) at `cap`, sharing the budget between paths by size. Below the cap the
 * paths are only rounded. For polygons, a simplified result whose rings cross is
 * rejected and simplified less, up to the original rings.
 */
export function capPaths(
  paths: Position[][],
  options: { rings: boolean; cap?: number }
): SimplifiedPaths {
  const cap = options.cap ?? VERTEX_CAP;
  const total = paths.reduce((sum, path) => sum + path.length, 0);
  if (total <= cap) {
    return { paths: paths.map((path) => path.map(roundPosition)) };
  }

  const minimum = options.rings ? 4 : 2;
  const simplifiers = paths.map((path) => {
    const budget = Math.max(minimum, Math.floor((cap * path.length) / total));
    const simplifier = new PathSimplifier(path, budget);
    simplifier.growTo(budget);
    return simplifier;
  });

  let out = simplifiers.map((s) => roundPath(s.result()));
  if (options.rings) {
    // Grow every ring by a quarter until the polygon is valid again.
    while (!ringsAreValid(out) && !simplifiers.every((s) => s.complete)) {
      for (const s of simplifiers) s.growTo(Math.ceil(s.points * 1.25));
      out = simplifiers.map((s) => roundPath(s.result()));
    }
  }

  const maxError = Math.max(...simplifiers.map((s) => s.maxErrorM));
  return {
    paths: out,
    simplification: {
      original_points: total,
      points: out.reduce((sum, path) => sum + path.length, 0),
      // Rounded up so the reported bound is never below the true error.
      max_error_m: Math.ceil(maxError),
    },
  };
}

// ---------------------------------------------------------------------------
// Ring validity
// ---------------------------------------------------------------------------

interface Edge {
  ring: number;
  index: number;
  last: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const orientation = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
  Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));

const onSegment = (e: Edge, x: number, y: number) =>
  x >= e.minX && x <= e.maxX && y >= e.minY && y <= e.maxY;

function edgesIntersect(p: Edge, q: Edge): boolean {
  const o1 = orientation(p.ax, p.ay, p.bx, p.by, q.ax, q.ay);
  const o2 = orientation(p.ax, p.ay, p.bx, p.by, q.bx, q.by);
  const o3 = orientation(q.ax, q.ay, q.bx, q.by, p.ax, p.ay);
  const o4 = orientation(q.ax, q.ay, q.bx, q.by, p.bx, p.by);
  if (o1 !== o2 && o3 !== o4) return true;
  return (
    (o1 === 0 && onSegment(p, q.ax, q.ay)) ||
    (o2 === 0 && onSegment(p, q.bx, q.by)) ||
    (o3 === 0 && onSegment(q, p.ax, p.ay)) ||
    (o4 === 0 && onSegment(q, p.bx, p.by))
  );
}

/** Edges that share a vertex along a ring, including the closing pair. */
const adjacent = (p: Edge, q: Edge) =>
  p.ring === q.ring &&
  (Math.abs(p.index - q.index) === 1 ||
    (p.index === 0 && q.index === p.last) ||
    (q.index === 0 && p.index === q.last));

/**
 * True when no two edges of the given closed rings touch or cross, apart from
 * neighbouring edges of the same ring. Edges are bucketed in a uniform grid of
 * about one edge per cell, and only edges sharing a cell are compared, so the
 * typical cost is linear.
 */
export function ringsAreValid(rings: Position[][]): boolean {
  const edges = ringEdges(rings);
  if (edges.length < 3) return true;

  const grid = new EdgeGrid(edges);
  const buckets = new Map<number, Edge[]>();
  for (const p of edges) {
    for (const key of grid.cellsOf(p)) {
      const bucket = buckets.get(key);
      if (!bucket) {
        buckets.set(key, [p]);
        continue;
      }
      if (bucket.some((q) => boxesOverlap(p, q) && !adjacent(p, q) && edgesIntersect(p, q))) {
        return false;
      }
      bucket.push(p);
    }
  }
  return true;
}

const boxesOverlap = (p: Edge, q: Edge) =>
  q.maxX >= p.minX && q.minX <= p.maxX && q.maxY >= p.minY && q.minY <= p.maxY;

/**
 * Square cells about two mean edges wide, so a cell holds a few edges of the
 * outline whatever the ring's shape. Cells never go below 1/64 of the longest
 * edge, which bounds how many cells one long edge covers. Buckets are sparse.
 */
class EdgeGrid {
  private readonly x0: number;
  private readonly y0: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cellW: number;
  private readonly cellH: number;

  constructor(edges: Edge[]) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let totalLength = 0;
    let longest = 0;
    for (const e of edges) {
      x0 = Math.min(x0, e.minX);
      y0 = Math.min(y0, e.minY);
      x1 = Math.max(x1, e.maxX);
      y1 = Math.max(y1, e.maxY);
      const length = Math.hypot(e.bx - e.ax, e.by - e.ay);
      totalLength += length;
      longest = Math.max(longest, length);
    }
    const side = Math.max((2 * totalLength) / edges.length, longest / 64) || 1;
    this.x0 = x0;
    this.y0 = y0;
    this.cols = Math.max(1, Math.ceil((x1 - x0) / side));
    this.rows = Math.max(1, Math.ceil((y1 - y0) / side));
    this.cellW = (x1 - x0) / this.cols || 1;
    this.cellH = (y1 - y0) / this.rows || 1;
  }

  /** Keys of the cells an edge's bounding box covers. */
  *cellsOf(e: Edge): Generator<number> {
    const col = (x: number) => Math.min(this.cols - 1, Math.floor((x - this.x0) / this.cellW));
    const row = (y: number) => Math.min(this.rows - 1, Math.floor((y - this.y0) / this.cellH));
    for (let cx = col(e.minX); cx <= col(e.maxX); cx++) {
      for (let cy = row(e.minY); cy <= row(e.maxY); cy++) yield cx * this.rows + cy;
    }
  }
}

function ringEdges(rings: Position[][]): Edge[] {
  const edges: Edge[] = [];
  rings.forEach((ring, r) => {
    if (ring.length < 4) return;
    const last = ring.length - 2;
    for (let i = 0; i <= last; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[i + 1];
      edges.push({
        ring: r,
        index: i,
        last,
        ax,
        ay,
        bx,
        by,
        minX: Math.min(ax, bx),
        maxX: Math.max(ax, bx),
        minY: Math.min(ay, by),
        maxY: Math.max(ay, by),
      });
    }
  });
  return edges;
}
