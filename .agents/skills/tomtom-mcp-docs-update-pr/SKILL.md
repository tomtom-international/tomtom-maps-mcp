---
name: tomtom-mcp-docs-update-pr
description: Find where the docs portal's public TomTom Maps MCP pages (documentation/tomtom-maps-mcp/ in tomtom-internal/devportal-documentation) disagree with this server — a tool, input, header, environment variable, MCP app, client or install step a page gets wrong or misses — and open or update a draft PR there that fixes them, in TomTom's tone of voice (tomtom-mcp-tov). Diff mode checks only what the current change touches and is run by tomtom-mcp-preflight before a push; audit mode compares every page against the latest release. Use when the user asks to "update the docs", "sync the docs portal", "are the MCP docs up to date", "audit the public docs", or to open the sibling docs PR for a change.
---

Keep the [docs portal's MCP pages](https://docs.tomtom.com/tomtom-maps-mcp/documentation/overview)
consistent with the server. [`CODING_GUIDELINES.md`](../../../CODING_GUIDELINES.md) § 10 holds the rules —
which changes owe a sibling PR, its branch and timing, the end-state voice; this skill applies them. Its
output is always a **draft** PR in `tomtom-internal/devportal-documentation`: the skill writes prose, and
that PR's review is where a person judges it.

| Invoked | Mode | Source of truth | Scope |
|---|---|---|---|
| by `tomtom-mcp-preflight`, or "update the docs for my change" | **diff** | the branch head | what the diff touches |
| "audit the docs", "are the MCP docs up to date" | **audit** | the latest release tag | every page, every surface |

Audit mode reads the release, not `main`: the pages describe the server readers connect to, and an
unreleased change gets its pages through its own sibling PR.

The commands are POSIX shell. Run each `gh` and `git push` in a shell call of its own, as
`.claude/settings.json` exempts only calls that start with them from Claude Code's sandbox.

## Step 1: Clone the pages

Pick the sibling branch first — `tomtom-maps-mcp/<this branch>` in diff mode,
`tomtom-maps-mcp/sync-<tag>` in audit mode — and look for its open PR:

```bash
gh pr list -R tomtom-internal/devportal-documentation --head tomtom-maps-mcp/<branch> --json number,url
```

Clone fresh — sparse and shallow, a few seconds, into the gitignored cache — from that branch when its PR
exists, so the skill updates the PR rather than opening a second; from `develop` otherwise. `--depth 1`
fetches that one branch only, so pick it here:

```bash
rm -rf node_modules/.cache/devportal-documentation
```

```bash
gh repo clone tomtom-internal/devportal-documentation node_modules/.cache/devportal-documentation -- --depth 1 --branch <develop, or the sibling branch> --filter=blob:none --sparse
```

```bash
git -C node_modules/.cache/devportal-documentation sparse-checkout set documentation/tomtom-maps-mcp
```

When an open docs PR already rewrites the pages this run edits, clone its branch instead and stack the
sibling on it, so the two don't conflict. Say so on the sibling's top line, and retarget it to `develop`
once that PR merges.

A `gh` 404 means no access. Stop and report "not checked: no access to devportal-documentation; the
maintainer opens the sibling PR" — it blocks nothing.

## Step 2: The surfaces

Each row pairs where the server defines something with the pages that describe it. List
`documentation/tomtom-maps-mcp/documentation/` first: the pages below are where things stood when this
skill was written, and a new page joins the row of its subject.

| Surface | Defined in | Described in |
|---|---|---|
| tools: names, purpose, the API each calls | `name:` and `description` in `src/tools/*Tools.ts`; `README.md` *Available Tools* | `tools.mdx`, `overview.mdx`, `examples/use-cases.mdx` |
| tool inputs worth naming, `response_detail` | the tool schemas in `src/schemas/` | `tools.mdx` |
| MCP apps: which tools render one, which clients show them, the `?apps=` and `MCP_APPS` override | `registerTomTomAppTool()` calls; `src/apps/`; `src/clientApps.ts`; `MCP_APPS` in `src/appConfig.ts`; `src/indexHttp.ts` | `interactive-maps.mdx` |
| the hosted server: endpoint, headers, authentication | `src/indexHttp.ts` (`tomtom-api-key`, `Authorization`) | `quick-setup.mdx`, `remote-vs-local.mdx`, `integration-guides/*.mdx` |
| environment variables | `src/appConfig.ts`, `.env.example`, `README.md` *Environment Variables* | `remote-vs-local.mdx`, `interactive-maps.mdx` |
| local install and run: package, `npx`, Docker | `package.json` `name` and `bin`, `Dockerfile`, `README.md` | `remote-vs-local.mdx`, `integration-guides/*.mdx` |
| the Claude Desktop extension: settings, platforms, Node version | `manifest-binary.json` `user_config`, `compatibility` | `integration-guides/claude-desktop.mdx` |
| what a reader sees | — | `images/`: screenshots and recordings, tool lists among them |

## Step 3: Find the inconsistencies

**Diff mode** — `git fetch origin main`, then `git diff origin/main...HEAD` plus the working diff. A stale
local `main` would pull other merged changes into the diff:

- `rg -n` every name the diff adds, renames or removes — tool, input, header, environment variable,
  package or command — over the clone's `documentation/tomtom-maps-mcp/`, old names included.
- Read in full every page in the row of a surface the diff touches: a page can describe a behaviour
  without naming it, and a new tool appears on no page yet.

**Audit mode** — the tag is the latest published release, `gh release view --json tagName --jq .tagName`
(not `git describe`, which also finds backup tags); `git fetch --tags` first:

- For each surface, list what the tag defines — `git grep -n 'name: "tomtom-' <tag> -- src/tools`,
  `git show <tag>:manifest-binary.json` — and what the pages describe.
- Compare both ways: defined but not described is **missing**; described but not defined at the tag is
  **stale**; both but disagreeing — a purpose, a header, a supported client — is **wrong**.
- Check every `tomtom-*` name and environment variable the pages mention, including those in code blocks.

A finding is something a reader following the page would now get wrong or miss — not wording you would
have chosen. None → "no page affected", and the skill ends at the report.

Then read the open PRs touching the pages
(`gh pr list -R tomtom-internal/devportal-documentation --search "tomtom-maps-mcp"`, then `gh pr diff`): a
finding one already fixes is reported with its link, not fixed a second time.

## Step 4: Edit the pages

- **The end state, for a first-time reader** — no "new", "no longer" or version history; the release notes
  carry it. In diff mode the page describes the server once this change is released.
- **TomTom's tone of voice** — read [`tomtom-mcp-tov`](../tomtom-mcp-tov/SKILL.md) before writing. Where
  that repository is stricter (its `CLAUDE.md` and `CONTEXT.md`, the page's neighbours), it wins.
- **Touch only what Step 3 found.** No reflow, no rewording of untouched paragraphs.
- **Images and recordings stay** — an agent cannot regenerate them; list each that shows the old surface.

## Step 5: Open or update the draft PR

The commit gate matches `git -C <clone> commit` too. Called from `tomtom-mcp-preflight`, run this step
only on its ready verdict, after it recorded the pass; a blocked change gets no sibling. Run on its own,
a denied commit names a `node … --passed <session>` command: run it once the pages are what Step 3
found, then commit again.

- New PR: `git -C node_modules/.cache/devportal-documentation switch -c <branch>`, then commit as
  `docs(tomtom-maps-mcp): <what changes>`.
- Push with `git push -u origin HEAD` from inside the clone. `git -C <clone> push` doesn't start with
  `git push`, so the sandbox exemption misses it. Where the shell tool takes a working directory, give it
  the clone; otherwise `cd` into it in one call, push in the next and `cd` back after.
- Existing PR: commit on its branch, push, and rewrite its body to the new end state.
- `gh pr create -R tomtom-internal/devportal-documentation --draft --base <develop, or the stacked PR's branch> --head <branch> --title "<the commit subject>" --body-file <file>`.

The body, in bullets:

- **Why** — the MCP PR it pairs with (diff mode; its branch until that PR exists), or the release tag it
  syncs to (audit mode).
- **Per page** — what changed, one bullet each.
- **Not in this PR** — the images to replace; that it stays a draft until the MCP PR merges, and reaches
  production with the release that carries it; the other open PRs of Step 3 touching the same pages, as
  likely conflicts.

Once the MCP PR exists, `gh pr edit` the sibling's body to link it, and link the sibling from the MCP PR's
description.

## Step 6: Report

Lead with the outcome: the sibling PR's link, "no page affected", or "not checked" and why. Then the findings
by page — missing, stale, wrong — each with the file in this repository that settles it, and the images left
for a person.
