# Context

Shared vocabulary for the TomTom Maps MCP server. Use these terms in code, issues and reviews. Design decisions that use them are recorded in [docs/adr/](docs/adr/).

## Consumers

**Integrator**
A customer whose own code runs the MCP client, usually inside an agent they built. Their code can read any part of a tool result and consume it directly, for example by drawing a route on their own map. The integrator is the primary consumer of geometry ([ADR 0001](docs/adr/0001-geometry-serves-integrators.md)).

**Standard host**
An off-the-shelf MCP client whose model reads tool results: Claude, ChatGPT, VS Code Copilot, Cursor. What reaches the model differs per host, and none of them reliably keeps a field away from the model.

**Model context cost**
The part of a tool result that reaches the model, measured in tokens. It is paid on every call, and by the whole conversation after it.

## Response content

**Point coordinates**
The single position of a place: a geocode result, a POI, a route's start and end. Always returned.

**Geometry**
Coordinate data beyond a single point: route lines, traffic incident locations, area-search boundaries. Omitted by default.

**Response detail**
The `response_detail` parameter, one value per job ([ADR 0003](docs/adr/0003-response-detail-geometry-value.md)):
- `compact` (default): answer the user. Essential fields and point coordinates, no geometry.
- `geometry`: draw it. `compact` plus size-reduced geometry as a GeoJSON FeatureCollection ([ADR 0004](docs/adr/0004-geometry-format-geojson.md)). Only on tools that have geometry.
- `full`: everything the API said. The untrimmed response, lossless, at many times the size.

**Vertex cap**
The maximum number of vertices per geometry feature in a `geometry` response: 1,000. Features above it are simplified and report `original_points`, `points` and `max_error_m` ([ADR 0005](docs/adr/0005-vertex-cap-simplification.md)).

**Join key**
A property on each geometry feature that gives its position in the compact response, such as `{"route": 0}` or `{"incident": 12}`. Valid only within one response; not an identifier ([ADR 0006](docs/adr/0006-feature-contents-and-join-keys.md)).

## Widget

**Widget**
The interactive map that hosts supporting MCP Apps render next to a tool result. Requested with `show_ui`. It never returns coordinates to the caller.

**App data**
What a widget draws: the untrimmed response, or a tool's own map state. It travels gzipped and base64-encoded in the tool result's `_meta` under `com.tomtom/app-data`, with route lines simplified until the whole result stays under 120,000 characters. A widget without it calls `tomtom-get-app-data` with the tool named in the text's `_meta.tool` and its own input, and any replica runs the tool again. The server keeps none of it ([ADR 0009](docs/adr/0009-app-data-in-the-tool-result.md)).

**App status**
What the server logs about app data, one line per event, with the tool, the client and its User-Agent:
- `App data`: how the result carried it (`delivery` "inline" or "fetch"), its sizes, and any `simplification`.
- `App data fetched`: a widget ran its tool again for data too large to inline.
- `App data fetched: host dropped it` (warn): the data was inline, so the host lost the result's `_meta`.
- `App data fetch failed` (warn).
- `App drawn` and `App failed` (warn): what each widget reports to `tomtom-report-app-status`, with the data's `source`, the failing `stage` and the time taken.

## Geometry delivery

**Inline geometry**
Geometry carried in the tool result itself, returned only when the caller asks for it, under a `geometry` key in the result's JSON. The chosen delivery ([ADR 0002](docs/adr/0002-inline-geometry-first.md), [ADR 0007](docs/adr/0007-geometry-key-in-text-json.md)).

**Handle** (deferred)
A reference returned instead of geometry, which the integrator's code uses to fetch it separately. A *stored handle* points at server-side storage; a *replay handle* encodes the request and re-runs it. Replay handles are rejected ([ADR 0002](docs/adr/0002-inline-geometry-first.md)).
