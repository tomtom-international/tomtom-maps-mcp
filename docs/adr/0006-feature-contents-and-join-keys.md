# 6. One feature per geometric item, joined to compact by position

- Status: accepted
- Date: 2026-09-24

## Context

`geometry` returns compact plus a FeatureCollection ([ADR 0003](0003-response-detail-geometry-value.md), [ADR 0004](0004-geometry-format-geojson.md)). The integrator must be able to tell which feature belongs to which compact result, for example which line is `routes[1]`.

Compact does not carry stable IDs for everything. Traffic compact deliberately drops incident IDs to save context.

Route sections (traffic, toll, ferry and others) locate themselves by vertex index on the line. Those indexes are invalid once the line is simplified ([ADR 0005](0005-vertex-cap-simplification.md)).

## Decision

**Contents.** One feature per geometric item:

| Tool | Features |
| --- | --- |
| Routing, waypoint routing, EV routing | One `LineString` per route; EV charging stops as `Point` |
| Reachable range | One `Polygon` per ring, with its budget |
| Traffic | One feature per incident, `Point` or `LineString` as the API returns it |
| Area search | The search boundary `Polygon` |
| Search along route | The route `LineString` |

**Join keys.** Each feature's `properties` carries a small join key giving its **position** in the compact response, not an ID. Examples: `{"route": 0}`, `{"incident": 12}`, `{"budget_min": 30}`. Features that were simplified also carry the `simplification` object.

**Route sections.** In phase 1 they carry no vertex indexes. They stay as compact describes them: type, length, delay.

## Consequences

- Join keys work on both backends and on every tool, including those without stable IDs.
- A join key is only valid within one response. Integrators must not store it as an identifier.
- **Drawing a section, such as a jam in red, is not possible in phase 1.** It needs its own `LineString` cut from the original line before simplification. This is a follow-up, added on demand.
- Removing section indexes matches the compact audit (#285), which drops them from compact because they point into coordinates compact has removed.
