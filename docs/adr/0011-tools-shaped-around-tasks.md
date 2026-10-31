# 11. Tools are shaped around tasks, with one scope input and names resolved on the server

- Status: accepted
- Date: 2026-10-30

## Context

Release 1.6.14 listed 13 model-visible tools, one per API endpoint. Seven of them searched for places: `tomtom-fuzzy-search`, `tomtom-poi-search`, `tomtom-nearby`, `tomtom-area-search`, `tomtom-ev-search`, `tomtom-search-along-route` and `tomtom-geocode`. Each took its area in its own shape, such as a `position` with a `radius`, a `polygon` or `boundingBox`, or an `origin` and `destination`. The routing tools took coordinates only.

A question such as "Italian restaurants in De Jordaan" therefore cost a model several calls:
1. geocode the neighbourhood;
2. look up the category code;
3. search with both.

Each hop is a chance to pick the wrong tool or copy a coordinate wrong, and each is another model call carrying the whole tool list.

## Decision

The model-visible tools answer a task, not an endpoint. There are eight:
- `tomtom-discover-places` and `tomtom-locate-place` for places;
- `tomtom-reverse-geocode` and `tomtom-poi-categories`;
- `tomtom-plan-route` and `tomtom-get-traffic`;
- `tomtom-dynamic-map` and `tomtom-data-viz`.

The 1.6.14 tools they replace answer with a retired-tool error naming the replacement ([ADR 0010](0010-retired-tool-names-answer.md)).

Where a tool looks is one input, `where`, chosen by `mode` (`within`, `nearby`, `maxDetour`, `global`); see *Scope* in [CONTEXT.md](../../CONTEXT.md). Every mode takes only its own fields, and an input a mode doesn't take is rejected rather than dropped.

A place is one input too: a name, `{ query }`, or coordinates, `{ position }` (*Location input*). The server resolves a name itself:
- an area name in `where.queries` resolves to its boundary polygon;
- a category word in `poiCategories` resolves to its code;
- a place name resolves by *Name match*: one fuzzy search over places and addresses together, preferring a match in the area the query names.

The response says where each name resolved, so a surprising answer can be traced to the name rather than the search.

A name that resolves to nothing is an error, never a wider search: a search for restaurants "near Dam Square, Amsterdam" must not answer from Virginia.

## Consequences

- **Models:** fewer calls per question, and fewer tool descriptions to tell apart. Over the capability tasks, medians of 3 runs interleaved with v1.6.14's and judged by gpt-4.1, tool calls fell from 103 to 32 on gpt-4.1 and from 68 to 29 on gpt-5.1, and answers grounded in the tool results rose from 20 to 28 and from 24 to 26.
- **Upstream requests:** the server now makes the lookups the model used to make, one request a name; the counts and corridors the tools now return replace follow-up calls. The server keeps nothing between calls: a result returns each area it resolved as a known area (see *Known area* in [CONTEXT.md](../../CONTEXT.md)), and a later call that passes it back skips the geocode. Over the capability tasks, each one question, the median of requests to the TomTom APIs fell from 98 to 94 for gpt-4.1 and rose from 68 to 86 for gpt-5.1, which on v1.6.14 sent coordinates and bounds from memory rather than look names up.
- **Tool selection says less:** with one tool absorbing seven, "did it call `discover-places`?" is nearly always yes. The evals assert the arguments too, such as the mode and the resolved category.
- **Inputs vary by mode:** an input's reach is checked per mode as well as per tool (`toolInputsReachApi.test.ts`, [ADR 0008](0008-tool-inputs-reach-the-sdk.md)).
- **Breaking:** callers that name a 1.6.14 search, geocode, routing or traffic tool get the retired-tool error and must move to the new tool and its inputs.
- **No handles:** there is no input for "the place found earlier" or "the route planned before", since the server holds nothing between calls ([ADR 0009](0009-app-data-in-the-tool-result.md)). A place is named or given as coordinates every time.
