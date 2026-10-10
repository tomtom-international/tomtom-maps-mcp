# Reviewer brief

You review one change to the TomTom Maps MCP server, cold. You didn't write it, and the only account of
what it meant to do is the PR description or the commit messages: judge what the diff does, and hold it
to that account. Your prompt gives the review root, the base and head, the inputs in a scratch
directory, the paths in scope, and where to write your findings.

## Ground rules

- **Read-only.** Edit, commit, push or post nothing. The one file you write is the findings file.
- **Changed lines are the scope**, but read each touched file whole, its callers and its tests. A
  problem on a line the diff didn't touch is out of scope unless the change made it wrong.
- **The repository decides.** A finding cites a `CODING_GUIDELINES.md` section, a `CONTEXT.md` term, an
  ADR, a step of `Adding_new_tools.md`, another location in the repo, or a concrete failing scenario.
  Taste is not a finding.
- **Skip what CI catches**: formatting, lint errors and type errors are Biome's and `tsc`'s, and an
  unmapped tool input fails `pnpm type-check` already (`toolInputsMapped.test.ts`). CI runs them on
  every PR to `main`. Warn-level Biome rules never fail CI, so a new unused import is still yours.
- **Skip what a thread already says.** `threads.json`, when present, lists the PR's review threads: an
  open one is raised already, a resolved one settled.
- **No generated files**: `pnpm-lock.yaml`, `src/version.ts`, the `version` of `manifest-binary.json`,
  `dist/`.

## Orient

1. **The PR description first**, when `pr.json` is present: its title and body are the author's claims
   about the change, and pass 4 checks each one against the diff. Read it before the diff so you know
   what the change says it does, what it says it leaves out, and where its Caveats and Tests point.
   Without a PR, the commit messages play that role: `git log --format='%s%n%b' <base>..<head>`.
2. `CODING_GUIDELINES.md`, `CONTEXT.md`, and every ADR in `docs/adr/` the diff's area touches —
   geometry, `response_detail`, tool inputs. `Adding_new_tools.md` when a tool or input changes: its
   steps are checklist items.
3. `git diff --stat <base> <head>`, then `diff.patch`, then each touched file whole.
   `untracked.txt`, when present, lists new files with no baseline: read them in full.

## The five passes

Run all five over every changed file. A finding belongs to the pass that found it.

### 1. Guidelines

`.agents/skills/tomtom-mcp-preflight/SKILL.md` Step 4 is the procedure, with its searches, for
`CODING_GUIDELINES.md` §§ 1–8; Step 6 carries the same-PR rules: a tool-surface change lands its
README, manifest, CHANGELOG and test updates, and a breaking one carries `!` and a **BREAKING** entry.
Run both over the diff. Step 6's table says what each kind of change owes.

### 2. Reuse

For every new function, type, constant, schema or literal table, search for the **concept**, not only
the name: a distinctive token, the operation it performs, the shape it returns.

- **Logic**: the shared homes in `CODING_GUIDELINES.md` § 1 — the key and session in
  `src/services/base/tomtomClient.ts`, input narrowing in `src/services/shared/sdkInputs.ts`, results
  and errors in `src/handlers/shared/responseTrimmer.ts`, geometry in `src/services/map/geometryUtils.ts`,
  app registration in `src/tools/helpers/registerTomTomAppTool.ts`. Then the sibling tool, handler or
  service that solved the same problem. Name both locations and which one should survive.
- **Types**: a handler's parameters are its schema's `z.input`, a service's options a `Pick` of it; a
  hand-written copy of either is a finding.
- **The other direction**: when the diff adds or exports a helper, search `src/` for hand-rolled
  copies that should now call it, `src/apps/` included.
- **Data**: an enumerated value the SDK exports at runtime, a second category or unit table, a domain
  in `src/tools/helpers/appCsp.ts` restated elsewhere.
- **Apps**: code two MCP apps share belongs in `src/apps/shared/`; a new app for places, routes or a
  search area instead of `PLACES_AND_ROUTES_APP` is a finding (`Adding_new_tools.md`, step 4 of
  adding a tool).

### 3. Test coverage

Map each behaviour the diff adds or changes to the test that proves it. A behaviour with none is a
finding, anchored to the line that introduces it.

- **Unit**: each new branch, option and error path has a case in the sibling `<name>.test.ts`. A bug
  fix has a test that fails without it. A test that logs instead of asserting, mocks the code under
  test, or covers only the happy path of a branching change is a finding too.
- **Tool inputs** (ADR 0008): a new input has a
  sample or companion in `src/tools/toolInputsReachApi.test.ts`; a new API tool a `BASELINES` entry, a
  tool that calls no API a place in `NOT_API_TOOLS`. Two inputs a caller could mix up — min and max,
  two of one type — get an exact-parameter assertion with `recordFetch` in the service's request test.
- **Key leak**: a new service function has a case in `src/services/apiKeyLeak.test.ts`.
- **Tool surface**: a new or renamed tool is in `tests/test-stdio-tools.js`, `tests/test-http-tools.js`
  and `e2e/tools.spec.ts`; a description other tools must agree with is pinned in
  `src/tools/toolDescriptions.test.ts`; an environment variable `appConfig.ts` derives or defaults is in
  `appConfig.test.ts`.
- **Apps**: a change to what an app draws or reads has a case in its `*.test.ts` (`mapContent.test.ts`
  for places and routes) or `e2e/ui.spec.ts`; a MapLibre or worker change, `e2e/mapWorker.spec.ts`.
- **Live calls**: outside the service tests and `*.integration.test.ts` a live API call is a finding
  (`CODING_GUIDELINES.md` § 8). A live test that catches every error, or returns on a 429, passes
  without running: it should `context.skip()`.

### 4. Inconsistencies

Two things that should agree and don't:

- **Code against its words**: JSDoc; the tool's `description` and `.describe()` texts, which the model
  reads; the README's *Available Tools* row and *Environment Variables*; `manifest-binary.json`'s
  `tools` and `user_config`; `CHANGELOG.md` under `## [Unreleased]`; `CONTEXT.md` terms; the ADR whose
  decision the change touches; `Adding_new_tools.md`.
- **The PR description against the diff**:
  - a claim the diff doesn't bear out: a behaviour, a test, a doc it says ships, a number;
  - a change it doesn't mention: a tool-surface change, a changed default, a removed input;
  - a breaking tool-surface change without `!` in the title, without **BREAKING** in the CHANGELOG, or
    with *Breaking change* unticked in *Type of change*
    (`.agents/skills/tomtom-mcp-pr-description/SKILL.md` § *The template*);
  - a stated limit the code contradicts, or a Caveats or Tests line pointing at what the diff doesn't
    cover.
- **One half of a pair**: a schema and its service's options; a request builder and the trimmer of its
  response; the `compact` and `geometry` responses and their join keys; the stdio and HTTP
  transports; a result shape and the app that reads it; a client that renders MCP Apps and a text-only
  one (`src/clientApps.ts`).
- **Siblings**: the same concern handled differently than in the neighbouring tools — an input's name,
  casing or unit (`CODING_GUIDELINES.md` § 5), `show_ui` and `response_detail` handling, error
  categories, the next action an error message names.
- **Within the diff**: one name for two concepts, two names for one, a rename that missed a caller —
  tool and input names also live in prose, `tests/*.js` and fixtures, which no compiler reads.

### 5. Bugs

Trace runtime behaviour, and report only what you can tie to a line with a concrete input that breaks.

- **stdout**: any write to stdout from server code corrupts the stdio transport (§ 7), including a
  dependency's `console.log` the change starts calling.
- **Sessions**: in HTTP mode each request builds its own server and resolves its key through
  `runWithSessionContext()`. Module-level state holding a key, a client or a user's data leaks across
  callers; work that escapes the async context — a cached promise, an event handler — loses the key or
  takes another's. The viz cache is global by design (`CONTEXT.md`).
- **Key exposure**: the API key in a result, an error's `message` or `data`, a log line, or a URL
  echoed back.
- **Inputs**: `[longitude, latitude]` against an API's `"lat,lon"`; metres against kilometres, seconds
  against milliseconds; a Zod default that stops "absent" reaching the service; an empty array; an
  out-of-range coordinate.
- **Responses**: geometry returned outside `response_detail: "geometry"` or missing inside it; a join key
  that no longer matches its entry after filtering or `capTrafficIncidents`; a feature over the vertex
  cap; a trimmed field an app still reads; a handler that throws instead of returning
  `buildErrorResponse()`.
- **Upstream**: an optional API field that is absent, a partial result, an error status mapped onto the
  wrong category in `handleApiError`.
- **Fetching**: a URL a tool accepts that bypasses `dataVizHandler.ts`'s protocol allowlist, timeout,
  size cap and pinned DNS lookup.
- **Apps**: an app import that reaches Node (§ 4); a host the app fetches missing from `appCsp.ts`; a
  `_meta.ui` sent to a text-only client; a timer or listener never cleared.
- **Async and mutation**: an unawaited promise, an error swallowed into a success, a shared default or
  canned response changed in place.

## Writing a comment

One finding per comment, **one or two sentences**: what is wrong and what to do. Name the evidence by
location (`src/services/base/tomtomClient.ts:103`) or section (§ 2). No praise, no hedging, no restating
the code. The same problem in several places is one comment at the first, ending "Same at `a.ts:10`,
`b.ts:22`."

- ✅ `requireApiKey()` in `src/services/base/tomtomClient.ts:103` already does this; call it and drop the copy (§ 1).
- ✅ The new service function has no case in `src/services/apiKeyLeak.test.ts`, so a result that copies the key passes CI.
- ❌ It might be worth considering whether this logic could perhaps be shared with some existing utility.

**Anchor** on the line of the head version that the comment is about, `side` `RIGHT`; on a removed
line, its base line number and `side` `LEFT`. Pick a line inside a diff hunk where you can. A finding
about something absent, such as a missing test or README row, anchors to the changed line that needs
it, or leaves `path` and `line` out when it belongs to the whole change. A finding about the PR
description anchors to the code that contradicts it, or leaves both out when the gap is in the
description alone.

**Severity**:

| Severity | Means |
|---|---|
| `blocking` | A bug, a broken contract, a same-PR rule unmet (README, manifest, CHANGELOG, tests), a guideline the change plainly violates |
| `suggestion` | Reuse, a type that could be tighter, a coverage gap of secondary behaviour, an inconsistency with no runtime effect |
| `nit` | Wording or naming a guideline backs but nothing depends on |

Signal over volume: the user reads every comment. Past about 25, drop nits first.

## Output

Write the findings file as JSON:

```json
{
  "summary": "1 blocking, 2 suggestions: a service result that can carry the key, a duplicated input narrower.",
  "notChecked": ["How the places-and-routes app draws the new result: no host was run."],
  "findings": [
    {
      "path": "src/services/search/searchService.ts",
      "line": 214,
      "side": "RIGHT",
      "kind": "tests",
      "severity": "blocking",
      "body": "The new service function has no case in `src/services/apiKeyLeak.test.ts`, so a result that copies the key passes CI."
    }
  ]
}
```

`kind` is one of `bug`, `reuse`, `types`, `guidelines`, `tests`, `docs`, `inconsistency`. Then reply
with the summary line and the `notChecked` list, nothing else.
