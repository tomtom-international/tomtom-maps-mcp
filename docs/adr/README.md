# Architecture decision records

Each record states one decision, why it was made and what it costs. Terms are defined in [CONTEXT.md](../../CONTEXT.md).

## Geometry for integrators

Customers building their own agents on the hosted server need route lines, reachable-range polygons and incident locations as data they can draw on their own map. Today these come back only with `response_detail: "full"`, about 640 KB for one long route. These records add `response_detail: "geometry"`: the compact response plus a size-capped GeoJSON FeatureCollection, identical on both backends.

| # | Decision |
| --- | --- |
| [0001](0001-geometry-serves-integrators.md) | Geometry serves integrators and must not cost standard hosts |
| [0002](0002-inline-geometry-first.md) | Deliver geometry inline first; defer handles |
| [0003](0003-response-detail-geometry-value.md) | Request geometry with `response_detail: "geometry"`; keep `full` |
| [0004](0004-geometry-format-geojson.md) | `geometry` returns a normalised GeoJSON FeatureCollection |
| [0005](0005-vertex-cap-simplification.md) | Cap geometry at 1,000 vertices per feature with anchored Douglas-Peucker |
| [0006](0006-feature-contents-and-join-keys.md) | One feature per geometric item, joined to compact by position |
| [0007](0007-geometry-key-in-text-json.md) | Put the FeatureCollection under a `geometry` key in the existing JSON text |

### Impact

- **Standard hosts:** no change unless a caller asks for `geometry`. The tool list grows slightly, because the new enum value appears on seven tools.
- **Integrators:**
  - one opt-in value;
  - one parser for both backends;
  - about 20 KB per feature at most, against about 640 KB for `full` today;
  - faster to produce than `full`.
- **Server:** no new infrastructure, state or endpoints. Simplification costs about 1 ms on a real long route and about 5 ms in the measured worst case.

### Risks

| Risk | Mitigation |
| --- | --- |
| The integrator's agent framework passes the geometry to their model | Size cap (ADR 0005). Opt-in only |
| Long routes look approximate when zoomed in (about 140 m of error at 2,600 km) | `max_error_m` on every simplified feature; `full` remains lossless |
| Simplified polygons self-intersect | Ring validity check with fallback, required in implementation |
| The GeoJSON shape becomes a contract we cannot change freely | Shape pinned by tests and documented in the README |
| Route sections cannot be drawn (vertex indexes are dropped) | Follow-up: section `LineString`s cut before simplification, on demand |
| Standard hosts differ in what reaches the model | Placement in the existing text JSON behaves the same everywhere (ADR 0007) |
