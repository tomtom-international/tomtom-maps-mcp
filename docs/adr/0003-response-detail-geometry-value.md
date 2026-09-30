# 3. Request geometry with `response_detail: "geometry"`; keep `full`

- Status: accepted
- Date: 2026-09-24

## Context

[ADR 0002](0002-inline-geometry-first.md) chose inline geometry as an opt-in. The caller needs a way to ask for it. Two shapes were considered:

- A third value on the existing `response_detail` parameter.
- A separate `geometry` parameter that also selects the format.

A separate parameter creates combinations with no clear meaning. `full` already contains raw geometry, so it is unclear what `response_detail: "full"` plus `geometry: "polyline"` should return.

Once geometry has its own value, one question follows: is `full` still needed?

## Decision

Extend `response_detail` to `"compact" | "geometry" | "full"`, and give each value one job:

| Value | Job | Content |
| --- | --- | --- |
| `compact` (default) | Answer the user | Essential fields and point coordinates |
| `geometry` | Draw it | `compact` plus the geometry, size-reduced |
| `full` | Everything the API said | Untrimmed response, lossless |

Only tools that have geometry accept `geometry`: routing, waypoint routing, EV routing, reachable range, traffic, area search and search along route. Point-only tools keep `compact | full`, so their schemas do not grow.

Keep `full` unchanged in behaviour.

## Consequences

- **`full` is still required.** It is:
  - the only way to get fields compact drops, such as turn-by-turn guidance, route sections, opening hours and brands;
  - lossless, while `geometry` simplifies and rounds;
  - the TomTom API's own shape, so the API docs apply to it;
  - parsed by existing integrators and by our own live test scripts.
- **`full` is repositioned.** Its description stops being the answer to "I need coordinates" and points callers to `geometry` instead.
- **Point indexes do not survive simplification.** Route sections refer to point indexes on the line, so `geometry` must not return index-based sections with a simplified line. This is resolved in the simplification decision.
- **The tool list grows slightly.** It is sent in every conversation, and the new value plus one sentence in the shared description add to it. The growth has to be measured when this is implemented.
- **`full` stays in the API.** Format selection is left out; one default format is chosen and an option is added only on demand.
