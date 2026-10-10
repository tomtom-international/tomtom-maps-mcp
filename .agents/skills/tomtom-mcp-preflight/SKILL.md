---
name: tomtom-mcp-preflight
description: ALWAYS run this before committing, pushing, or opening a PR in the TomTom MCP server repository — there are no git hooks here, so it is the only gate before CI. Also use it whenever the user asks to "preflight", "check", or "review my changes for consistency". Before a commit it runs a cheap tier (type-check, Biome, offline unit tests); before a push, also the build, e2e and live-API gates CI runs — both scoped to what you touched; audits the diff against CODING_GUIDELINES.md — duplicated helpers and types, imprecise types, verbose comments, abbreviated names, stdout writes, API-key leaks; catches debug leftovers and stray files; and enforces that any change to a tool or tool input ships its README, changelog, MCPB manifest and test updates in the same PR. For bug hunting use a code review; for refactors a simplification pass.
---

Gate the **working diff** before it becomes a commit or PR. Consistency and completeness, not bug
hunting. [`CODING_GUIDELINES.md`](../../../CODING_GUIDELINES.md) holds the rules; Step 4 verifies the
diff against them. **There are no git hooks in this repository**, so every gate below is a CI job or
nothing — which is why `.claude/settings.json` and `.cursor/hooks.json` deny `git commit` until this
skill has passed once in the session (Step 7).

The commands are POSIX shell: Git Bash on Windows, which Claude Code's Bash tool uses. Searches use
`rg` — on Windows `winget install BurntSushi.ripgrep.MSVC`, or use the agent's own search tool.

- **Fix**: Biome autofixes on touched files, generated churn, stale references after a rename, doc rows
  derivable from the code, debug artifacts, Step 4.
- **Report**: anything needing invented intent — new prose, an ADR, naming judgement, whether an
  untracked file belongs in the commit, whether a change is breaking.

## Step 1: Scope

- `git status --short`, `git diff`, `git diff --cached` → the touched files and the **areas** driving
  Step 2. Scope everything below to those; never audit the whole repo unless asked to — then run every
  gate and search over the whole tree, and fix only what needs no invented intent.
- Read untracked files fully — no baseline, and the likeliest source of Step 5 problems.
- **Generated churn**: `pnpm build` rewrites `src/version.ts` and the `version` of `manifest-binary.json`
  from `package.json`. A diff in either that the change did not intend is churn — `git checkout --` it.
  Versions are bumped by `prepare-release.yml` on release, never by hand.
- Stage explicit paths afterwards, not `git add -A`.

## Step 2: Gates

Two tiers, each scoped to what the diff touches:

- **Commit** — what the commit gate asks for. No build, no API key, no quota; under half a minute.
- **Push** — before pushing or opening a PR, add the push rows. They are the gates of
  [`Adding_new_tools.md`](../../../Adding_new_tools.md) § Before opening a PR and what PR CI runs;
  [`quality_checks.yml`](../../../.github/workflows/quality_checks.yml) and
  [`build-mcpb.yml`](../../../.github/workflows/build-mcpb.yml) own the order.

| Tier | Touched | Run |
|---|---|---|
| commit | anything | `pnpm type-check` → `pnpm lint` → `pnpm format:changed` |
| commit | `src/**` | the offline unit tests, below |
| commit | `ui/**` | `pnpm ui:build` (`tsc --noEmit` + Vite) — no CI job runs it |
| push | `src/**` | `pnpm build` → `pnpm test:all` |
| push | `src/apps/**`, `scripts/build-apps.ts`, a MapLibre or `@modelcontextprotocol/ext-apps` bump | after `pnpm build`: `pnpm exec playwright test e2e/mapWorker.spec.ts` (needs Chromium: `pnpm exec playwright install chromium`) |
| push | `manifest-binary.json`, `scripts/build-mcpb.cjs`, `bin/**` | `pnpm build:mcpb` |

The offline unit tests are every vitest file outside the two homes guidelines § 8 allows live calls
in. The placeholder key satisfies the tests that stub the API, and keeps a real key in `.env` from
being spent:

```bash
pnpm exec cross-env TOMTOM_API_KEY=offline vitest run --exclude "src/services/**/*Service.test.ts" --exclude "**/*.integration.test.ts"
```

Collect every failure in one pass rather than stopping at the first, and attribute each to `biome` /
`tsc` / `vitest` / `playwright` / `build` so the user knows what CI blocks on.

**Judge every gate by its exit code** — read `$?`, or run it unpiped and read the tool's own summary
line (`Found N errors`, `error TSxxxx`, `Test Files N failed`). Never conclude a gate passed from a
`grep` over its output: these commands colour and wrap their diagnostics and pnpm prefixes them, so a
`grep` that returns zero is only evidence the pattern was wrong.

```bash
pnpm lint > /dev/null 2>&1; echo "lint exit=$?"   # 0 or it blocks CI
```

- **`pnpm type-check` is also the first [ADR 0008](../../../docs/adr/0008-tool-inputs-reach-the-sdk.md)
  check**: an unmapped tool input fails it in `toolInputsMapped.test.ts` with `ExpectNever<"key">`.
- **Formatting is enforced on changed files only**, for the reason in
  [`CONTRIBUTING.md`](../../../CONTRIBUTING.md) § Coding Standards. Fix with
  `pnpm exec biome format --write --changed src`, never `pnpm format:fix`. `format:changed` compares
  against the local `main`, so a stale `main` widens the set — CI resets it to `origin/main`.
- **`pnpm lint` is `biome lint src`** — no formatter, no import sorting.
- **Warnings never fail `pnpm lint`, so CI never shows them** — Biome's recommended set and
  `biome.json` put dozens of rules at `warn`, from `noUnusedImports` to `noNonNullAssertion`. Run
  `pnpm exec biome lint <touched files>` and read what it prints: warnings **on touched lines** are
  findings, pre-existing ones are not. An import the change left unused is the commonest; a function
  the change pushed over `noExcessiveCognitiveComplexity` the easiest to miss.
- **`pnpm test` calls the live API** in the service tests, so it needs a real `TOMTOM_API_KEY` and
  spends quota — which is why it is push tier. `test:tools:stdio` / `test:tools:http` call it too, and
  drive the built `dist/`, so they need `pnpm build` first. Fix the code if a test encodes intended
  behaviour; if the change intentionally alters behaviour, update the test and say so.
- **Changed `package.json`** (root or `ui/`) without a matching `pnpm-lock.yaml` fails every CI job
  (guidelines § 9).

## Step 3: Expensive checks — run, or leave to CI

Push tier only; skip this step before a commit.

| Check | Run locally when the diff touches | CI job |
|---|---|---|
| `pnpm test:e2e` (after `pnpm test:e2e:setup`) — `tools.spec.ts` and `ui.spec.ts` need an API key | `src/apps/**`, `ui/**`, the HTTP transport | **none** — CI runs `mapWorker.spec.ts` only |
| The live with-and-without call of [`Adding_new_tools.md`](../../../Adding_new_tools.md), step 3 of adding an input | a new tool input or input combination | **none** — `toolInputsReachApi.test.ts` stubs the API |
| `pnpm build:mcpb` | the bundle's inputs (Step 2) | `build-mcpb.yml` |

Outside CI, Playwright reuses whatever already listens on ports 3000 and 8080 — possibly another
checkout's server, so the run tests the wrong code. Check with `lsof -iTCP:3000 -sTCP:LISTEN` (Windows:
`netstat -ano | findstr :3000`), or run with `CI=1` to make Playwright start its own. `tools.spec.ts` calls the live API and has flaky cases;
before blaming the change for one, run the same spec on `origin/main`.

Name whatever you skip in the report, with the CI job from the table above (or "none").

## Step 4: The coding guidelines

[`CODING_GUIDELINES.md`](../../../CODING_GUIDELINES.md) is the rule set; this step verifies the diff
against it, on **changed lines only**. Do not restate the rules in the report — cite the section. Four
sections need active searching; the rest you catch by reading the diff.

**§ 1 Reuse** — the commonest and costliest slip, because nothing flags it. For every new function,
type, constant or literal block in the diff:

- `git grep` a distinctive token from it across the repo. A hit outside the diff is a finding: name
  both locations and which one should survive.
- Check it against the shared-homes table in § 1: a new key lookup, value converter, response builder,
  geometry helper or test stub that one of those already provides.
- Duplicated **data** counts: an enum literal the SDK already exports, a second category table.
- Hand a large extraction to a simplification pass rather than doing it unasked.

**§ 2 Types** — `tsc` proves the code compiles, never that the type says what is possible:

- Two or more optional properties on one new or changed internal type → can they legally coexist? If
  not, it should be a discriminated union. In a tool schema, the service rejects the combination instead.
- `git diff -U0 | rg 'as [A-Z]'` → each `as` either narrows instead or justifies itself. Casts into SDK
  parameter types are `sdkParamTyping.test.ts`'s.
- A handler or service type written out by hand next to its schema → `z.input` / `Pick`.

**§ 3 Comments and docs** — read every comment, JSDoc block and doc paragraph the diff adds:

- Flag one that narrates the next line, runs past three lines, repeats the parameter name in `@param`,
  or carries history rather than the end state ("no longer", "was renamed", "used to").
- `git grep` a distinctive phrase from each new explanation: a concept spelled out at several call
  sites belongs at the definition, `CONTEXT.md` or the ADR that owns it.
- Every new or changed `description` and `.describe()`: a coordinate without its order, a quantity
  without its unit, a shared sentence written out instead of taken from its helper.
- A new source file without the licence header.

**§ 5 Naming** — `rg -n '\b(res|req|err|idx|el|ref|arg|dest|src|msg|prev|curr)\b'` over the changed
lines; loop counters, `config` and `params` are the sanctioned exceptions. A new term missing from
`CONTEXT.md`, or one used against its definition there.

**§ 7 Domain rules** — searched, not read:

- `git diff -U0 -- src ':!src/apps' | rg '^\+.*console\.'` → any hit breaks the stdio transport.
- ``git diff -U0 | rg '^\+.*new \w+Error\(\s*`'`` → an interpolated value moves into `data`; a
  parameter name may stay.
- A new error message that leaves the model no next action.
- A new service function without a case in `src/services/apiKeyLeak.test.ts`.
- New geometry in a result that does not go through `response_detail: "geometry"`.

Everything else — `[longitude, latitude]` order, sibling tests, no new barrels, app imports reaching
Node — is a read of the diff against §§ 4, 7 and 8.

## Step 5: Strays and debug leftovers

- **Untracked files** — for each `??`, does it belong here? A throwaway live-API probe must not be
  committed: it runs in CI and burns quota. Report; never `git add` or delete a file the user hasn't
  accounted for.
- **Never committed**: a TomTom key or bearer token in any file, `.env` or any variant but
  `.env.example`.
- **Debug artifacts** — `*probe*`, `*dump*`, `*scratch*`, `debug-*`; a `.test.ts` with no `expect`; a
  test that `console.log`s a response instead of asserting; a live test that catches every error, or logs
  and returns on a 429, so it passes without running — skip it with `context.skip()` instead.
- **Focused / disabled tests** — `it.only`, `describe.only`, `.skip`, `test.todo`. A `.only` silently
  shrinks CI coverage.
- **Leftover debugging** — `debugger`, commented-out blocks, a context-free `TODO`.
- **Orphaned app** — a tool retired while `src/apps/<category>/<app>/` stays.

## Step 6: Cross-surface consistency — the check nothing else performs

**A tool-surface change** lands its surfaces **in the same PR**, or the verdict is **blocked**, not a
finding. "Tool surface" = anything a client or the model can observe: a tool's name, title,
`description` or inputs; its result shape, geometry included; its MCP app; an environment variable or
HTTP header the server reads.

| Changed | Must move with it |
|---|---|
| a tool added, renamed or removed | [`Adding_new_tools.md`](../../../Adding_new_tools.md) § Adding a tool, steps 5 and 6; plus `e2e/tools.spec.ts` and the app directory |
| a tool input added, removed or changed | [`Adding_new_tools.md`](../../../Adding_new_tools.md) § Adding an input to an existing tool; `CHANGELOG.md` — a removed advertised input under **BREAKING**; `README.md` where it documents the input |
| a tool's `description` | `toolDescriptions.test.ts` where it pins the wording; the tool's row in `README.md` *Available Tools*; its entry in `manifest-binary.json`'s `tools` |
| a result shape or geometry | `README.md` § Getting geometry out of a tool response, which documents the shape as a contract; the app that reads it; the ADR whose decision it changes |
| an environment variable or header | `.env.example` and `README.md` *Environment Variables* for one a user sets; `user_config` in `manifest-binary.json` only for one a desktop-extension user sets; `appConfig.test.ts` when `appConfig.ts` derives or defaults it |
| a new concept, or a decision with lasting cost | its entry in `CONTEXT.md`; a new ADR and its row in `docs/adr/README.md` |
| a convention for adding tools or inputs | `Adding_new_tools.md` |
| a CI gate or command | this skill, `CONTRIBUTING.md`, and `Adding_new_tools.md` § Before opening a PR |

Start every rename or removal with `git grep -l '<oldName>'` from the root — tool and input names live
in prose, test fixtures and `tests/*.js`, which no compiler reads.

**Changelog**: a user-visible change gets an entry under `## [Unreleased]` in `CHANGELOG.md` (Keep a
Changelog sections — `Added`, `Changed`, `Removed`, `Fixed`). A breaking one is marked `**BREAKING**:`
and says what a client has to change.

**Release surface**:

- **Breaking tool surface** — the commit and PR title carry the conventional-commit `!`
  (`refactor!: …`), matching the history.
- **Commits are signed off** (DCO, [`CONTRIBUTING.md`](../../../CONTRIBUTING.md)): every commit on the
  branch has a `Signed-off-by:` trailer — `git log main..HEAD --format='%h %(trailers:key=Signed-off-by)'`.
  Commit with `git commit -s`.
- **Added external-resource fetching** (a URL a tool accepts, as `tomtom-data-viz` does) — confirm
  bounded handling: protocol allowlist, timeout, streamed size cap.
  `new URL()` alone is not validation.

## Step 7: Report

Lead with the verdict — **ready to commit** (commit tier), **ready to push** (push tier) or
**blocked**, and by what. Then briefly:

- **Fixed** — what changed, grouped by kind, with paths.
- **Findings** — most important first (`path:line`, what's wrong, why it matters, suggested fix),
  grouped by the step that found them so the failing gate is obvious.
- **Surfaces** — for a tool-surface change, the docs, manifest and tests updated and any still
  outstanding; if none were needed, why.
- **Not run** — every skipped check (before a commit, the whole push tier) and the CI job covering it.
- **Commit / PR title** — if one is next, the proposed conventional-commit title (`!` if breaking);
  [`tomtom-mcp-pr-description`](../tomtom-mcp-pr-description/SKILL.md) writes the body.

Paste failing output rather than summarising it. If a gate didn't pass, say so in the verdict — never
"ready to push" with the failure buried below.

**Record the pass** only on a ready verdict: if the commit gate denied a commit this session, run the
`node … --passed <session>` command its message named, then commit. Never on a blocked verdict.
