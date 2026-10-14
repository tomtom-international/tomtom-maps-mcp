---
name: tomtom-mcp-tov
description: Apply TomTom's tone of voice to the TomTom MCP server's public copy — the developer portal's MCP pages, README.md, CHANGELOG.md entries and the description in manifest-binary.json. Use when writing or rewriting any of those, when tomtom-mcp-docs-update-pr edits a portal page, or when asked for a tone-of-voice or TOV pass. Not for tool descriptions, code comments, ADRs, skills or PR bodies, which have registers of their own.
---

TomTom's tone of voice for this repository's public copy. The rules below are this repository's summary of
TomTom's internal `tomtom-tov` skill (`tomtom-internal/ai-coding-agent-marketplace`, `catalog/tomtom-tov`).
The full guide is internal, and this repository is public, so don't copy it here. Keep this summary in our
own words, and limited to what developer documentation needs.

## What it applies to

| Public copy, so the voice applies | Not public copy |
|---|---|
| the developer portal's MCP pages (`tomtom-mcp-docs-update-pr`) | a tool's `description` and `.describe()` texts: the model reads them ([`CODING_GUIDELINES.md`](../../../CODING_GUIDELINES.md) § 3) |
| `README.md` | code comments, JSDoc, ADRs, `CONTEXT.md`, the guidelines and the skills |
| `CHANGELOG.md` entries, which become the release notes | PR bodies (`tomtom-mcp-pr-description` § *Voice*) and review comments |
| `manifest-binary.json`'s `display_name`, `description` and `long_description` | |

Apply it to what you write or rewrite. A file you only pass through is no reason for a voice pass.

## The voice

- **Confident.** State what the server does, with the fact that proves it. No boasting, no hedging.
- **Accessible.** Plain words a developer new to maps follows. Explain a mapping term the first time, or
  link to where it's explained.
- **Inspiring, in its place.** An overview or a use case may show what a reader can build. A setup step or
  a reference table just says what to do.

## The principles

- **Write naturally.** If nobody would say the sentence out loud, rewrite it. Vary sentence length.
- **Show, don't claim.** A number, an example or a result beats an adjective: "returns up to 100 results"
  rather than "powerful search".
- **Lead with the solution, never soften the fact.** Say what works and how. A limit, a breaking change or
  a removed tool is stated plainly. Optimism never hides it.
- **Write for a developer.** Go as deep as the task needs, in plain English.

## The style rules

- **Active voice**: "The server returns the route", not "The route is returned".
- **Headings in sentence case**, with no final punctuation. A heading uses a colon, not a dash, and the
  word after the colon takes a capital.
- **No Oxford comma in a simple list**: "search, routing and traffic". Keep it where a complex sentence
  needs it to parse.
- **Dashes**: an en dash for a range (10–20 km). On the developer portal, use a colon, comma or full stop
  where you'd reach for an em dash.
- **Numbers**: one to nine in words, 10 and up as numerals. Code values, versions, units and counts
  in a table stay numerals.
- **Dates and times**: "April 6, 2025", never "April 6th"; "9am", "10:30pm".
- **A URL shown as text** drops `https://` and `www.`. A link keeps its full target.
- **Identifiers stay as written.** A tool name, input, header or environment variable keeps its exact
  spelling and casing, in code font, wherever it appears, headings included.

## Words to avoid

| Instead of | Write |
|---|---|
| cutting-edge, state-of-the-art, next-generation | what is actually new, and why it matters |
| leverage | use |
| actionable insights | what the reader can now do |
| data-driven | the data doing something |
| robust, scalable, seamless | the limit, the number or the behaviour behind the claim |
| dramatic language about the problem | the problem in one sentence, then the solution |

## Where rules meet

- **A fact beats the voice.** A rewrite that makes a limit sound smaller is wrong.
- **The host's own style wins where it's stricter**: the developer portal's `CLAUDE.md`, `CONTEXT.md` and
  neighbouring pages, or `CODING_GUIDELINES.md` § 3's length limits for `README.md`.
- **Don't run a writing interview.** The table above names the audience and the channel, so write without
  asking for them.
