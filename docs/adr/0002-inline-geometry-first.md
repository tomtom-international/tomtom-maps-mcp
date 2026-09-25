# 2. Deliver geometry inline first; defer handles

- Status: accepted
- Date: 2026-09-24

## Context

[ADR 0001](0001-geometry-serves-integrators.md) makes the integrator the primary consumer of geometry. An integrator's agent still has a model in the loop, and most agent frameworks pass the whole tool result to that model before the integrator's code can take it. We do not know which framework the integrators who raised this use.

Three delivery options were considered:

- **Inline**: geometry in the tool result, only when requested, in a compact encoding.
- **Stored handle**: the result carries an ID, and the integrator's code fetches the geometry with a second call.
- **Replay handle**: the ID encodes the original request, and fetching it re-runs the API call.

## Decision

Deliver geometry **inline**, as an explicit opt-in.

- **Stored handle**: deferred. Revisit only if an integrator shows that inline geometry, after size reduction, is still too large for their model.
- **Replay handle**: rejected.

## Consequences

- Works with every MCP client, including those that pass only text back to the caller, such as the OpenAI Responses API.
- No new infrastructure: no shared store, no per-user scoping, no expiry semantics.
- Because the framework is unknown, assume the integrator's model reads the geometry. Size reduction is therefore part of the design, not an optimisation.
- **Why replay is rejected**: routes depend on live traffic, so a replayed request can return a different line from the one whose distance and ETA the agent already reported. Every fetch is also a second billed API call.
- **Why a stored handle is deferred**: it needs storage shared across server instances, since HTTP mode is stateless and runs several replicas. It also needs scoping to the caller's identity, because today's viz cache can be read by anyone holding the ID, and it needs an expiry the model can recover from.
