# 9. Send app data inside the tool result; keep the viz cache as the fallback

- Status: accepted
- Date: 2026-10-15

## Context

A widget draws from more data than the agent gets: the untrimmed response, or a tool's own map state. The server stored it in the viz cache and the result text carried its `viz_id`, which the widget fetched with `tomtom-get-viz-data`.

The viz cache lives in one process, and HTTP mode is stateless and runs several replicas. The widget's fetch is a new request that any replica can answer, so on the hosted server half the fetches missed (20 of 40 measured with two pods; dev, with one pod, missed none) and the widget stayed empty.

The tool result has room for most of that data. The MCP Apps specification hands the result's `_meta` to the widget and keeps it out of the model's context. The host limits what it carries:

- **Claude** stores a result of more than about 150,000 characters outside the conversation, and the widget then never receives it.
- **ChatGPT** was reported in 2026 to drop custom `_meta` before it reaches the widget.

| App data | JSON | gzip, base64 |
| --- | ---: | ---: |
| Fuzzy search | 9 KB | 3 KB |
| Routing, Amsterdam to Berlin | 220 KB | 93 KB |
| Search along that route | 230 KB | 95 KB |
| Dynamic map, Amsterdam to Madrid | 483 KB | 218 KB |
| Routing, Lisbon to Warsaw | 1.0 MB | 442 KB |

## Decision

- The result carries the app data gzipped and base64-encoded in `_meta` under `com.tomtom/app-data` whenever the whole result stays under **120,000 characters**.
- The viz cache keeps holding every app data and the text keeps its `viz_id`, so a widget that finds nothing inline still fetches as before.
- A tool whose widget draws only from its tool input sends no app data: `tomtom-traffic`.
- A widget whose data can't be loaded shows an error rather than an empty frame.

Deferred, for the app data too large to inline:

- **Session affinity** at the gateway, hashing the `Mcp-Session-Id` once the server issues one to every client. Its misses come back whenever a replica restarts or the pool scales.
- **Shared store** for the viz cache: new infrastructure on the request path, and it needs scoping to the caller, as [ADR 0002](0002-inline-geometry-first.md) notes for stored handles.

Rejected:

- **Replaying the request** when the widget fetches: rejected for the same reasons as in [ADR 0002](0002-inline-geometry-first.md), a second billed call that can return a different route.
- **`structuredContent`**: ChatGPT passes it to the model ([ADR 0007](0007-geometry-key-in-text-json.md)).

## Consequences

- Most widgets draw without a second request, on any replica, and still draw when the conversation is reopened after the cache has expired.
- Long routes and large datasets still go through the cache, and a fetch for them still misses when it reaches another replica.
- A result with inline app data is larger on the wire, by about 3 to 95 KB.
- Encoding costs one gzip of the app data per call, skipped when its JSON is more than ten times the room left.
