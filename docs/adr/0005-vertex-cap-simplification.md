# 5. Cap geometry at 1,000 vertices per feature with anchored Douglas-Peucker

- Status: accepted
- Date: 2026-09-24

## Context

[ADR 0004](0004-geometry-format-geojson.md) fixes the format. Size is controlled by simplification, which is also where `geometry` loses accuracy.

A fixed tolerance fits no single case. 10 m drifts about 7 pixels off the street at zoom 16 in Amsterdam, which matters on a short walking route, and still leaves a 3,000 km route too large. A caller-chosen tolerance adds a parameter to the tool list, which every conversation pays for, and asks the model to choose a number it cannot reason about.

The approach had to be shown to perform. The server runs on Node.js and handles every request on one thread, so CPU time spent simplifying delays every other request.

## Decision

Every geometry feature in a `geometry` response is capped at **1,000 vertices**.

- **Below the cap:** the feature is returned as the API gave it, with coordinates rounded to 5 decimals.
- **Above the cap:** it is simplified with priority-driven Douglas-Peucker.
  - The algorithm repeatedly inserts the vertex with the largest perpendicular error until the cap is reached.
  - It measures error in a local metric projection.
  - Before starting, it pins evenly spaced anchor vertices, `min(64, cap / 8)` of them.
- **No caller parameter.** The cap is a server constant.
- **Every simplified feature reports what happened**, for example `"simplification": {"original_points": 8134, "points": 1000, "max_error_m": 11}`, so the integrator knows the line is lossy and can fall back to `full`.

## Measurements

Node 24, median of 21 runs, including rounding and serialisation.

| Input | Points in | Time (median) | Time (p95) | Max error | Size | Today's `full` serialisation |
| --- | --- | --- | --- | --- | --- | --- |
| Amsterdam–Berlin (real route) | 7,577 | 1.0 ms | 1.7 ms | 11.5 m | 18.7 KB | 3.9 ms, 519 KB |
| ~2,600 km (synthetic) | 30,308 | 2.0 ms | 3.9 ms | 143 m | 19.2 KB | 14 ms, 2.2 MB |
| ~7,900 km (synthetic) | 90,924 | 4.5 ms | 11.8 ms | 805 m | 19.5 KB | 44 ms, 6.7 MB |
| Pathological zigzag | 50,000 | 5.2 ms | 7.1 ms | 33 m | 14.1 KB | 18 ms, 3.2 MB |
| Isoline ring | 801 | 0.2 ms | 0.2 ms | 0 m | 14.7 KB | 0.4 ms, 68 KB |

`geometry` is faster than today's `full` in every case, because serialising a large payload costs more than simplifying it.

Two alternatives were measured and rejected:

- **Douglas-Peucker without anchors** is equally good on real routes, but took 321 ms on the pathological input. Its worst case grows with points × cap.
- **Visvalingam-Whyatt** has a guaranteed bound, but on the real route it was 7× slower (12 ms) with 10× the error (124 m). It minimises area, not distance from the line.

## Consequences

- Worst-case size per feature is about 20 KB, whatever the distance.
- **Long routes become visibly approximate when zoomed in**: about 140 m of error at 2,600 km and about 800 m at 7,900 km. They look right at the zoom that fits the whole route on screen. The reported `max_error_m` is how integrators know when to use `full`.
- **Polygons can self-intersect after simplification.** The implementation must check ring validity and fall back to a less simplified ring. This is untested so far.
- **Route sections that refer to vertex indexes** cannot be returned alongside a simplified line.
- The 1,000 cap and the anchor count are constants to tune from real use.
