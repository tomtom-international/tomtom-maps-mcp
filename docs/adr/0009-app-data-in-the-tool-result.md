# 9. Send app data inside the tool result, fitted to the host's limit

- Status: accepted
- Date: 2026-10-15

## Context

A widget draws from more data than the agent gets: the untrimmed response, or a tool's own map state. The server kept it in an in-process cache, and the widget fetched it with a second request. HTTP mode is stateless and runs several replicas, so that request could reach a replica without the data: on the hosted server, with two pods, 20 of 40 fetches missed and the widget stayed empty.

What the hosts and the specification offer:

- **`_meta` is the widget's channel.** The MCP Apps specification hands the widget the whole `CallToolResult` and keeps `_meta` out of model context. OpenAI documents a result's `_meta` as "delivered only to the component, hidden from the model". ChatGPT dropped custom `_meta` from February to May 2026; it now passes it. Cursor is reported to strip it.
- **Size.** Claude keeps a result of more than about 150,000 characters out of the conversation, and its widget never receives it.
- **No session to route by.** The 2026-07-28 MCP revision removes `Mcp-Session-Id`. ChatGPT's widget calls don't send one, and Claude opens a separate session for the app bridge, so no gateway can route a widget's call to the replica that ran the tool.
- **Route lines are most of the data**, 83 to 90% of every large payload, at full float precision.

| App data | Points | As is (gzip, base64) | Fitted |
| --- | ---: | ---: | ---: |
| Fuzzy search | 4 | 3 KB | as is |
| Routing, Amsterdam to Berlin | 8,240 | 93 KB | as is |
| Search along that route | 8,240 | 95 KB | as is |
| Dynamic map, Amsterdam to Madrid | 20,571 | 218 KB | 113 KB, 14,065 points, 2 m |
| Routing, Lisbon to Warsaw | 39,414 | 424 KB | 108 KB, 9,646 points, 8 m |

## Decision

- **Inline.** The result carries the app data gzipped and base64-encoded in `_meta` under `com.tomtom/app-data` whenever the whole serialized result stays under **120,000 characters**.
- **Fitted.** Route lines that don't fit are rounded to 1 m, then simplified with the anchored Douglas-Peucker of [ADR 0005](0005-vertex-cap-simplification.md) until they do. Every vertex a property points at (a section's start and end, a progress point) is kept and the indices renumbered, so traffic, tolls and borders still draw where they are. The data a caller gives `tomtom-data-viz` is never altered.
- **TomTom tools never run again.** A TomTom tool's widget without inline data (a host that drops `_meta`, or data too large even simplified) shows an error and reports it. Running the tool again would be a second billed TomTom request that usage figures can't tell from the first, since the SDK's User-Agent is shared by the whole process.
- **Data-viz is fetched by running it again.** Its data is kept exact, so a large dataset never fits. The data-viz widget calls the app-only `tomtom-get-app-data` with its own tool input, and any replica runs `tomtom-data-viz` again, which only downloads `data_url`. The server runs no other tool through it. The server keeps no app data between requests.
- **Traffic sends only the bounds it searched**: its widget draws live traffic there. A bounding box in the input frames it before the result arrives; a named area has no bounds until the server resolves it.
- **Never silent.** Each widget shows an error rather than an empty frame and reports the outcome to `tomtom-report-app-status`. The server logs every step (CONTEXT.md, App status).

Rejected:

- **An in-process cache**, the previous design: a fetch that reaches another replica misses.
- **Session affinity**: hosts don't send a session ID on widget calls, and the specification removes it.
- **A shared store** (Redis): new infrastructure on the request path that needs scoping to the caller, as [ADR 0002](0002-inline-geometry-first.md) notes for stored handles, when the data fits once fitted.
- **`structuredContent`**: ChatGPT passes it to the model ([ADR 0007](0007-geometry-key-in-text-json.md)), and Claude Desktop is reported to strip it.

This narrows [ADR 0002](0002-inline-geometry-first.md)'s rejection of replaying a request: the model never gets a handle to replay, and only the data-viz widget, lacking its data, runs its tool again.

## Consequences

- Widgets draw on any replica without a second request, and still draw when a conversation is reopened.
- A long route's line is drawn within a few metres of the route; the text answer keeps the exact figures.
- In a host that drops `_meta`, or for a route too long to fit even simplified, a TomTom tool's widget shows an error instead of a map; the text answer is unaffected. The server logs it either way.
- A data-viz widget that must fetch costs a second download of `data_url`.
- Fitting costs up to about 200 ms for a 3,300 km route, against a routing call of several seconds.
- A result with inline app data is larger on the wire, by about 3 to 113 KB.
