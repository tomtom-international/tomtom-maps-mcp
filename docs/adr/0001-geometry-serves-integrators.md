# 1. Geometry serves integrators and must not cost standard hosts

- Status: accepted
- Date: 2026-09-24

## Context

Customers building their own agents on the hosted server reported that no tool returned geometry they could draw on their own map. Geometry is available only through `response_detail: "full"`, which returns the whole untrimmed API response: about 640 KB for an Amsterdam-to-Berlin route, roughly 160k tokens.

Two kinds of consumer read tool results, and they want opposite things:

- An **integrator** owns the MCP client and wants the coordinates as data.
- A **standard host** passes the result to its model, where every byte is context cost. Research showed that Claude Code, VS Code Copilot and ChatGPT send `structuredContent` to the model, so no result field is reliably hidden from it.

## Decision

Design geometry delivery for the integrator. It must not change what a standard host receives unless the caller explicitly asks for geometry.

- The default response of every tool stays as it is today.
- Geometry is returned only when requested.

## Consequences

- No regression in context cost for existing users of the hosted server.
- Integrators must opt in per call, so the option has to be discoverable in the tool and parameter descriptions.
- A mechanism that only a custom client can use, such as a handle fetched out of band, is acceptable, because the integrator writes that client.
