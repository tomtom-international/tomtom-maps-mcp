# 10. A retired tool name answers with the tools that replace it

- Status: accepted
- Date: 2026-10-27

## Context

The model calls the tools the server lists in the current session, so it never asks for a tool that is gone. Other callers name tools without listing them first:
- scripts, workflows and agent configurations that hard-code a tool name;
- client permission lists, such as Claude Code's `mcp__tomtom__tomtom-routing` entries;
- prompts that name a tool.

The hosted server at mcp.tomtom.com moves every caller to a new release at once. For a name it does not register, the MCP SDK returns the tool error `Tool <name> not found`, which says nothing about what to call instead. Releases 1.6.11 to 1.6.13 removed five tools this way: `tomtom-static-map`, `tomtom-waypoint-routing`, `tomtom-ev-routing`, `tomtom-reachable-range` and the app-only `tomtom-get-viz-data`.

Listing a placeholder for each retired tool would put it in front of the model on every turn. That costs tokens, and it adds a wrong choice to tool selection.

## Decision

A tool name, once merged, is never free again. When a tool is renamed or removed, its name moves to `RETIRED_TOOLS` in `src/tools/retiredTools.ts` with:
- `lastRelease`, the last release that listed it;
- `replacedBy`, the listed tools that do its job now, possibly none;
- `message`, the error the caller reads: the tools to call instead and how the old inputs map onto them, or why no tool does.

The server does not list retired tools. `answerRetiredTools` sits in front of the SDK's `tools/call` handler. A call to a retired name gets an `IncorrectError` result, with `details` holding the tool, `lastRelease` and `replacedBy`, whatever arguments it carries. The call is logged as `Retired tool called` with the client name. Every other call goes to the SDK.

The error is the whole answer: a retired name never runs its replacement. The replacement's inputs differ, so translating a call would mean keeping a second, slightly different tool surface.

`src/tools/toolNames.json` lists every tool name ever merged, live or retired. Names are only added to it. `retiredTools.test.ts` fails when:
- the server registers a name the file lacks;
- the file holds a name the server neither registers nor retires;
- a retired tool's `replacedBy` names a tool the server does not register;
- a retired tool's message leaves out its own name or a replacement.

The preflight skill blocks a diff that deletes a name from `toolNames.json`.

## Consequences

- **Callers:** a call to a retired name gets an error naming the tools to call instead, rather than `Tool not found`.
- **Model context cost:** none. Retired tools are not listed.
- **Contributors:** adding a tool adds its name to `toolNames.json`. Renaming or removing one adds a `RETIRED_TOOLS` entry. When an entry's replacement is itself retired, the entry moves on to the tool that replaced it.
- **SDK coupling:** the MCP SDK has no public way to answer an unknown tool name, so `answerRetiredTools` reads the handler the SDK installed from its private handler map. If an SDK upgrade renames that map, `createServer` throws and every server test fails.
- **Entries are permanent:** one costs a map row, and the `Retired tool called` logs show who still calls each name.
