# 11. A previous tool contract is documented in the error

- Status: accepted
- Date: 2026-10-29

## Context

[ADR 0010](0010-retired-tool-names-answer.md) answers a tool name the server no longer registers. A second kind of break leaves the name in place and changes the contract: an input is removed or reshaped, or the result no longer has what callers read.

The model sees the new schema in `tools/list`, so it does not send the old inputs. Scripts, workflows and agent configurations do. They hard-code the arguments. The schema then either strips an unknown input and runs the call as if it had not been sent, or rejects it with the SDK's `Input validation error`, which names the schema failure and not what changed. Release 1.6.12 did this to tools that kept their names, among them `tomtom-routing`, `tomtom-traffic` and the search tools.

Translating the old call would mean keeping the previous schema alive beside the current one. The inputs differ, and a result the caller parses has no signal that it wanted the old shape.

## Decision

A tool that keeps its name and breaks its contract gets an entry in `CONTRACT_CHANGES` (`src/tools/contractChanges.ts`) with:
- `lastRelease`, the last release that had the previous contract;
- `triggers`, the argument paths that show a call is on that contract: `present` for an input the schema no longer accepts, `string` for an input that stayed but used to be a string and is now a list;
- `message`, what the caller reads: how the old inputs map, or why they have no counterpart, and what the result no longer contains.

`answerRetiredTools` checks a call that is not a retired name. When a trigger matches and `tools/list` offers this client the tool, the call is not run. It gets an `IncorrectError` whose `details` hold the tool, `lastRelease` and the `inputs` that matched, and it is logged as `Previous tool contract called`. A client that is not offered the tool gets the SDK's answer instead. A call on the current contract is passed to the SDK unchanged, including one whose result shape changed: a successful call is the current contract, and there is no argument that says the caller wanted the old result.

The error is the whole answer. The call is not rewritten onto the new inputs.

## Consequences

- **Callers:** a call that still sends a removed input, or a string where a list is required, gets an error that says what changed, rather than a stripped success or `Input validation error`.
- **A result-only change:** it is described in the message of a tool that also has an input trigger, so the input error carries it. A change with no such input has no call to reject. The changelog and the tool description carry it.
- **Model context cost:** none. The tool stays listed once, with its current schema.
- **Contributors:** breaking a tool's inputs adds or extends its `CONTRACT_CHANGES` entry in the same change. Retiring that tool deletes the entry: the retired-tool error answers the name. `contractChanges.test.ts` fails when an entry names a tool the server does not register or has retired, when a `present` input is still on the schema, or when the message leaves out the tool or an input.
- **Entries stay** while the tool is registered and callers can still send the old inputs. The `Previous tool contract called` logs show which.
