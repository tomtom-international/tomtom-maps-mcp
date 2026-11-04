# 13. Hold each result on the server, per process, named by a `dataset_id`

- Status: proposed (proof of concept)
- Date: 2026-11-04

## Context

A compact result answers only what survived the trimming. Searches stop at `limit`, traffic shows the `maxResults` most severe incidents, and a model asked for a count over the whole set counts the rows it was shown. Returning every row instead costs the conversation hundreds of thousands of tokens.

[ADR 0002](0002-inline-geometry-first.md) deferred a stored handle because it needs:
- storage shared across replicas, since HTTP mode is stateless and runs several;
- scoping to the caller's identity;
- an expiry the model can recover from.

[ADR 0012](0012-tools-shaped-around-tasks.md) records the consequence, *No handles*: the server holds nothing between calls.

## Decision

- **Held.** `tomtom-discover-places`, `tomtom-locate-place`, `tomtom-plan-route`, `tomtom-get-traffic` and `tomtom-data-viz` store their full, untrimmed result with the context of the call, and the result names it by `dataset_id` (*Dataset* in [CONTEXT.md](../../CONTEXT.md)). `tomtom-derive-datasets` stores what its code returns the same way.
- **Per process.** The store is a map in the server's own memory (`src/services/datasets/dataset-store.ts`), with no shared storage.
- **Scoped to the caller.** Entries are keyed by a SHA-256 digest of the resolved API key. Another caller's id reads as missing, so the store never confirms it exists.
- **Expiring.** A dataset lives `DATASET_TTL_SECONDS` (default 600) after it was last read. Its provenance lives four times longer, so a miss names the call to re-run. Nothing is replayed for the model, as ADR 0002 rejects replay.
- **Bounded.** 64 MB and 100 datasets per caller, 256 MB and 500 per process, by serialized length; the oldest go first, from the heaviest caller.
- **Addressable.** A `dataset_id` works as a location, in `where.within.dataset_ids`, `where.nearby` and the route modes, and in `tomtom-data-viz`. `response_detail: "dataset"` returns the handle without the rows.
- **Computed over in a child process.** `tomtom-analyse-datasets` and `tomtom-derive-datasets` run the model's JavaScript in a child with no environment, an empty working directory, read access to `node_modules` only, a 512 MB heap, a 10 s timeout and at most four at once (`process-executor.ts`). It can't read files or credentials, but can reach the network: Node's permission model doesn't cover sockets. The HTTP server registers these two tools only when `DATASET_CODE_OVER_HTTP` is `true`.

## Consequences

- **Models:** a question over every row costs an aggregate rather than the rows, and two results combine without either crossing the conversation.
- **A miss on another replica.** A follow-up that reaches a replica other than the one that ran the tool finds no dataset, and the error asks for the call to be re-run. With no session to route by ([ADR 0009](0009-app-data-in-the-tool-result.md)), this is the hosted server's normal case, not an edge.
- **Data-viz can't fetch a dataset again.** Its widget runs `tomtom-data-viz` again on any replica for data too large for the result (ADR 0009), where a `dataset_id` may miss. Such a drawing is refused instead.
- **Memory:** up to 256 MB of datasets per process, plus up to four children of 512 MB each.
- **Egress:** code the model writes can send a dataset it was given to any host. It only gets its own caller's datasets, so the exposure is what that caller could already read through the tools.
- **What it revisits:** ADR 0002's deferred stored handle, here for the model rather than an integrator's geometry, and without the shared store 0002 asks for; ADR 0012's *No handles*. ADR 0009 holds: the server keeps no app data.

## Open items

- **A store shared across replicas**, with the same owner scoping and expiry, or a decision that datasets serve stdio and single-replica deployments only. Until then this stays proposed.
- **An egress policy** at the container level before `DATASET_CODE_OVER_HTTP` is set on a shared endpoint.
- **Superseding** ADR 0002's deferral and ADR 0012's *No handles* once this is accepted.
