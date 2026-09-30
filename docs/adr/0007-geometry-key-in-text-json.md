# 7. Put the FeatureCollection under a `geometry` key in the existing JSON text

- Status: accepted
- Date: 2026-09-24

## Context

Every tool returns a single text content block holding JSON. The MCP Apps widgets and the live test scripts read `content[0].text`. Three placements for the FeatureCollection were considered:

- **A key in the same JSON:** `{...compact, "geometry": {FeatureCollection}}`.
- **An embedded resource block** with `mimeType: "application/geo+json"` and `annotations.audience: ["user"]`.
- **`structuredContent`**, with an `outputSchema`.

What we know about hosts:

- **`audience: ["user"]`** is honoured only by VS Code Copilot, as far as we could verify. How the Anthropic API MCP connector and ChatGPT handle embedded resources is unverified.
- **`structuredContent`** is sent to the model by Claude Code, VS Code Copilot and ChatGPT. VS Code and Claude Code send only `structuredContent` when it is present. Cursor currently drops results that have only structured content.
- **An `outputSchema`** would bind every mode of a tool to one schema.

## Decision

`geometry` responses add a `geometry` key holding the FeatureCollection to the existing JSON text block. Nothing else about the result changes:

- same single text block;
- no embedded resource;
- no `structuredContent`.

## Consequences

- Works identically on every MCP client.
- Additive: widgets, live test scripts and anything else reading `content[0].text` keep working.
- Integrators parse one JSON document and read `.geometry`.
- **Standard hosts pay the geometry in model context** when a caller asks for it: about 20 KB per feature at the cap. This is accepted because it is opt-in ([ADR 0001](0001-geometry-serves-integrators.md)).
- **When to revisit:** an embedded resource marked `audience: ["user"]` is the natural upgrade once its handling is verified on the Anthropic API connector and ChatGPT.
- **Widget and viz cache:** `geometry` behaves like `compact`. With `show_ui` it caches the untrimmed result for the widget exactly as today.
