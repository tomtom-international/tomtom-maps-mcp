# Context

Shared vocabulary for the TomTom Maps MCP server. Use these terms in code, issues and reviews. Design decisions that use them are recorded in [docs/adr/](docs/adr/).

## Consumers

**Integrator**
A customer whose own code runs the MCP client, usually inside an agent they built. Their code can read any part of a tool result and consume it directly, for example by drawing a route on their own map. The integrator is the primary consumer of geometry ([ADR 0001](docs/adr/0001-geometry-serves-integrators.md)).

**Standard host**
An off-the-shelf MCP client whose model reads tool results: Claude, ChatGPT, VS Code Copilot, Cursor. What reaches the model differs per host, and none of them reliably keeps a field away from the model.

**Client name**
The `clientInfo.name` a client sends at `initialize`, kept as sent so the logs and the gateway's analytics hold the exact provenance and any grouping happens in the queries; `unknown` without a name, or on a request without the session that carried it. Over HTTP it travels base64url-encoded in the `Mcp-Session-Id` and reaches the analytics as `client` in `TomTom-Upstream-Metadata`.

**Model context cost**
The part of a tool result that reaches the model, measured in tokens. It is paid on every call, and by the whole conversation after it.

## Tool surface

**Retired tool**
A tool name a release listed that the server no longer registers, kept in `RETIRED_TOOLS` (`src/tools/retiredTools.ts`). It is never listed, and a call to it gets an error naming the tools that replace it ([ADR 0010](docs/adr/0010-retired-tool-names-answer.md)).

**Tool name ledger**
`src/tools/toolNames.json`: every tool name ever merged, live or retired. Names are only added, so a name that leaves the server must become a retired tool.

## Naming places and areas

**Location input**
How a tool takes one place: a name, `{ query }`, or coordinates, `{ position }` as `[longitude, latitude]`. The server resolves a name itself, by *Name match*, so no geocode call comes first. A name several places share is qualified in the query itself: "Paris, France". There is no variant that points at an earlier result, since the server holds none (App data).

**Scope**
The `where` input: where a tool looks, chosen by `mode`.
- `within`: an area. City, district or neighbourhood names in `queries`, each resolved to its boundary polygon where the Geometry Data service has one and to its bounding box otherwise; `areas`, **known areas** earlier results returned; a `boundingBox`; or `geometries`, GeoJSON polygons. The fields given are unioned, up to 10 of each. A name that resolves to no area is an error, never a wider search.
- `nearby`: a point and `radiusMeters` (default 1,000). The point is a `position`, or a landmark `query`, looked up as `tomtom-locate-place` looks up a name. A name that resolves to no point is an error.
- `within` ranks what it finds by how near each place is to the centre of its area, taking each area's nearest in turn: in an area the API's own order says nothing about where a place is.
- `maxDetour`, on `tomtom-discover-places` only: stops along a drive between `locations`, each adding at most `maxDetourTimeSeconds` of driving, in the order `sortBy` names: `detourOffset`, the order the drive reaches them, or `detourTime`, the extra time each adds.
- `alongRoute`, on `tomtom-get-traffic` only: a corridor `withinMeters` (default 1,000) either side of the drive between `locations`, queried in pieces that each stay within the traffic API's 10,000 km² cap.
- `global`: no constraint, and the default when `where` is omitted.

`tomtom-get-traffic` takes `within`, `nearby` and `alongRoute`. `tomtom-discover-places` reports the scope it searched under `searched`, with where each name in `queries` resolved.

**Known area**
An area an earlier result resolved, as `searched.resolvedAreas[].area` and a located city, district or neighbourhood's `area` report it: its name, bounding box and boundary id. `within.areas` takes it back and searches the same area without a geocode, with one boundary request, or none when only the bounds are needed. It carries the area rather than pointing at anything the server holds, so it is not a **Handle**.

**Name match**
How a place name becomes one place: one fuzzy search, which asks the POI index and the geocoder together, for the whole query, area and all. Its order is the best guide (the city Frankfurt am Main before a Legoland ride called "Frankfurt"; the address "Prinsengracht 263" before the street), and three things outrank it: lying in the area the query names after a comma ("…, Amsterdam"), not a business of that name in Zeist; within that area, a name equal to the one asked for, the Alexanderplatz square before its Christmas market, while an exact name with no area to hold it to proves nothing; and, when a boundary is asked for, having one. The runners-up are returned as `alternatives`. A location input or a `nearby` landmark refuses a best match that is neither in the named area nor named exactly what was asked for.

## Response content

**Point coordinates**
The single position of a place: a geocode result, a POI, a route's start and end. Always returned.

**Geometry**
Coordinate data beyond a single point: route lines, traffic incident locations, the boundary polygon of a city, district or neighbourhood. Omitted by default.

**Response detail**
The `response_detail` parameter, one value per job ([ADR 0003](docs/adr/0003-response-detail-geometry-value.md)):
- `compact` (default): answer the user. Essential fields and point coordinates, no geometry.
- `geometry`: draw it. `compact` plus size-reduced geometry as a GeoJSON FeatureCollection ([ADR 0004](docs/adr/0004-geometry-format-geojson.md)). Only on tools that have geometry.
- `full`: everything the API said. The untrimmed response, lossless, at many times the size.

**Vertex cap**
The maximum number of vertices per geometry feature in a `geometry` response: 1,000. Features above it are simplified and report `original_points`, `points` and `max_error_m` ([ADR 0005](docs/adr/0005-vertex-cap-simplification.md)).

**Join key**
A property on each geometry feature that gives its position in the compact response, such as `{"route": 0}` or `{"incident": 12}`. Valid only within one response; not an identifier ([ADR 0006](docs/adr/0006-feature-contents-and-join-keys.md)).

**Route analysis**
What `tomtom-plan-route` adds to each route from its geometry, sections and guidance: the `roads` named by their road shields, the `countries` crossed, the distance at each speed limit, the tunnels and built-up length, the manoeuvres counted by kind, the curves when asked, and an alternative's comparison with the first route (`src/tools/shared/route-analysis.ts`). The maps-sdk measures road and section lengths along the geometry, so they can differ by a few percent from the distances in the route's progress.

## Widget

**Widget**
The interactive map that hosts supporting MCP Apps render next to a tool result. Requested with `show_ui`, which adds no coordinates to the text the model reads: the widget's data, coordinates included, travels in the result's `_meta` (App data).

**App data**
What a widget draws: the untrimmed response, or a tool's own map state. It travels gzipped and base64-encoded in the tool result's `_meta` under `com.tomtom/app-data`, with route lines simplified until the whole result stays under 120,000 characters. That `_meta` is the result's only one. The text carries `show_ui`, and the tool name when the result has app data, so a host that drops the result `_meta` can still hide the map. A widget without it shows an error: a TomTom tool never runs again for its widget, since that would be a second billed request. The data-viz widget alone calls `tomtom-get-app-data` with its own input, and any replica runs `tomtom-data-viz` again, which only downloads `data_url`. The server keeps none of it ([ADR 0009](docs/adr/0009-app-data-in-the-tool-result.md)).

**App status**
What the server logs about app data, one line per event, with the tool, the client and its User-Agent:
- `App data`: how the result carried it (`delivery` "inline" or "too_large"), its sizes, and any `simplification`.
- `App data too large for the result: the app can't draw` (warn): a TomTom tool's data didn't fit even simplified, so its widget shows an error.
- `App data fetched`: the data-viz widget ran `tomtom-data-viz` again for data too large to inline.
- `App data fetched: host dropped it` (warn): the data was inline, so the host lost the result's `_meta`.
- `App data fetched: app failed to decode it` (warn): the data was inline and reached the widget, which couldn't decode it.
- `App data fetch failed` (warn): a tool other than `tomtom-data-viz`, arguments it rejects, or a run that failed.
- `App drawn` (info) and `App failed` (warn): what each widget reports to `tomtom-report-app-status`, with the data's `source`, the failing `stage` and the time taken.

## Geometry delivery

**Inline geometry**
Geometry carried in the tool result itself, returned only when the caller asks for it, under a `geometry` key in the result's JSON. The chosen delivery ([ADR 0002](docs/adr/0002-inline-geometry-first.md), [ADR 0007](docs/adr/0007-geometry-key-in-text-json.md)).

**Handle** (deferred)
A reference returned instead of geometry, which the integrator's code uses to fetch it separately. A *stored handle* points at server-side storage; a *replay handle* encodes the request and re-runs it. Replay handles are rejected ([ADR 0002](docs/adr/0002-inline-geometry-first.md)).
