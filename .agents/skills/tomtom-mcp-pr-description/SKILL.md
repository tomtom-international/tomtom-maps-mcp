---
name: tomtom-mcp-pr-description
description: Write, rewrite or compact a pull request title and description for the TomTom MCP server. Use when opening a PR, when the user asks to update, compact or improve a PR body or add a diagram to it, when a PR is stacked on another, or when a rename left a body's links or claims stale. Covers filling the repository's PR template (problem and solution inside Description), a body of bullets with size ceilings and a closing cut pass, links to each file's diff and each commit, one Caveats section scoped to this diff, a How Has This Been Tested? table limited to what CI cannot show, the conventional-commit title, mermaid diagrams, MCP app screenshots, and publishing with gh pr edit.
---

The description is the **review artifact**: a reviewer has to reach the solution from it without
reading the diff first. State the problem, then the shape of the answer, then walk the diff with
links. [`tomtom-mcp-preflight`](../tomtom-mcp-preflight/SKILL.md) runs first and proposes the title;
this skill writes the body.

## The template

Every PR fills [`.github/pull_request_template.md`](../../../.github/pull_request_template.md), and
keeps its four headings in order — reviewers scan for them:

1. **`## Description`** — the body proper; its structure is below.
2. **`## Type of change`** — delete the options that don't apply; **Breaking change** ticked exactly
   when the title carries `!` and `CHANGELOG.md` has a **BREAKING** entry. A parenthesis may say
   what the docs update covers.
3. **`## How Has This Been Tested?`** — see *Tests*.
4. **`## Checklist:`** — tick only what is true; drop a line that doesn't apply rather than leave it
   unticked without a reason. The DCO line is ticked only when every commit carries `Signed-off-by:`.

Then the attribution footer.

## Inside Description

In this order; only the first two are always there.

1. **Top line**, for a stacked PR: `Stacked on #314` plus what the diff against that parent contains,
   and that the quality checks run only on PRs to `main`, so the results below are local. The *only*
   place the stack is discussed.
2. **Problem** — what is wrong today, who it hurts (the model, an integrator, a host), and the
   evidence: a live call, a count, a before/after. Open with the problem, never a verdict.
3. **Solution** — the shape of the answer before any file is named: the mechanism and what it
   replaces, or the rule it enforces with its ADR. A one-file fix skips it.
4. **The diff, in sections** (`###`) — one per mechanism or area, ordered as a reviewer must read
   them: what the rest depends on first. Commits are kept on merge, so a section that is one commit
   links its heading to that commit.
5. **Breaking changes** — when the title carries `!`: a `Was` / `Is now` / `Why` table that agrees
   with the CHANGELOG's **BREAKING** entries.
6. **Screenshots** — when an MCP app changes visually.
7. **Open items** — a gap this PR still means to close.
8. **`### Caveats`** — see *Caveats*.
9. **`### Follow-ups`** — only the author's own plan beyond this PR.

## Compact and technical

**Prose is the failure mode.** Keep every load-bearing fact — a live-call result, a count against
`main`, a breaking-change row, an open item — and cut the sentences around it. No sentence that
announces the next one, no scene-setting, no recap of the section above.

**The body is bullets.** A section opens on its list, table, fence or diagram:

- **One idea per bullet, one line long.** When a bullet needs a second sentence it **nests**: the
  claim stays on the parent, the number or qualification goes under it.
  - Two levels, never three. A third level is a section of its own, or a table.
- **A framing line, at most one per section**, only where no bullet can carry it.
- **A list of one bullet is a line**; a list of ten is two lists, or a table.

**Bold carries the scan**: one to three words per bullet, on the word the bullet turns on — never a
whole sentence, never in a table cell that repeats its column, never on a heading.

**Budgets are ceilings, not targets:**

| Part | Ceiling |
|---|---|
| Top line | one line |
| Problem | ~5 bullets, plus the evidence table |
| Solution | ~5 bullets, or a diagram |
| A diff section | as long as its mechanism needs — the one place detail is welcome |
| Tests | the table, rows CI can't show only |
| Caveats | 3–5 bullets, one line each |
| Open items, Follow-ups | bullets only, no preamble |

**Verbosity rises through the body**: Problem and Solution are the tightest parts, the diff sections
carry the detail. A Solution longer than the sections under it means the body is upside down.

**Current state only** — the body describes the diff at the head SHA. No "first we tried", no account
of how the branch changed under review. Use the [`CONTEXT.md`](../../../CONTEXT.md) terms, and link
an ADR rather than restating its decision.

**Then cut.** Read the draft once for deletions only, and expect to lose a fifth of it: a paragraph
that survived the bullet pass, a sentence restating its heading or the table under it, an adjective
doing no work, a second example where the first lands, a hedge the Caveats already carry, a row CI
already reports.

## The title

The repository merges with merge commits, so the title is not the commit message on `main` — every
commit is, and each needs a conventional subject and a sign-off. No CI job checks the title; keep
it to the history's form anyway:

- `type(scope): subject` — scope is the tool or area (`traffic`, `apps`, `http`, `auth`, `deps`),
  omitted when the change spans many.
- `!` before the colon for a breaking tool-surface change: `refactor(traffic)!: …`.
- Fix it with `gh pr edit <n> --title '…'`.

## Tests

CI's quality checks run type-check, lint, format, build, the map-worker e2e spec and `test:all` — and
only on PRs to `main`. So the table carries what the checks tab cannot:

- **Live API evidence** — the with-and-without calls of
  [`Adding_new_tools.md`](../../../Adding_new_tools.md) for a new input, with the result on this
  branch and on `main`.
- **What no CI job runs** — `tools.spec.ts` and `ui.spec.ts`, `pnpm ui:build`, a manual check in a
  host (Claude Desktop, the MCP Inspector, the `ui/` host).
- **A count against `main`** where the change moves it — lint warnings, failing guards.
- **Every gate**, when the PR is stacked and CI won't run.
- A **known flake**, named, with whether it also fails on `main`.

Never a narration of the run, and never a row for a gate CI reports on this PR. Something no check can
cover is a caveat, not a row.

## Caveats

**One `### Caveats` section**, after Open items and before Follow-ups. Nowhere else.

**Three to five bullets, one line each**, every one about the solution in this diff:

- a **judgement call**, with the alternative named;
- a claim we **can't verify here**, and what would verify it;
- a **side effect** a reviewer wouldn't look for — a tool description the model now reads
  differently, an input another tool inherits, a host that renders the app differently;
- a mechanism that is only **probably** enough.

Not a caveat: what another PR owes (the top line), the history of this PR, a gap this PR still closes
(**Open items**), later work (**Follow-ups**), or a risk invented for balance.

## Links

**Link rather than explain.** Public repository: link what an outside contributor can open — an ADR,
`CONTEXT.md`, an issue, another PR, an upstream doc. An internal ticket key goes on the top line at
most, never an internal wiki page.

**Every file the body names, linked to its diff** on the **Files changed** tab, where the change is
highlighted. The anchor is `diff-` plus the SHA-256 of the repository-relative path:

```bash
# every path in the PR with its anchor — never name the loop variable `path`: zsh ties it to $PATH
gh pr view <n> --json files --jq '.files[].path' | while read -r filePath; do
    printf '%s\tdiff-%s\n' "$filePath" "$(printf '%s' "$filePath" | shasum -a 256 | cut -d' ' -f1)"
done
gh pr view <n> --json files --jq '.files[] | "\(.additions + .deletions)\t\(.path)"' | sort -rn
```

- Append `R<first>-R<last>` to the anchor to land on the changed lines.
- A path the PR doesn't touch has no anchor, and its link lands silently at the top of the list — the
  second command is the "still in the PR?" check.
- A **commit link** (`/pull/<n>/commits/<sha>`) for a section that is one commit.
- A **blob link** only for a file the PR doesn't change, pinned at the head SHA
  (`gh pr view <n> --json headRefOid --jq .headRefOid`), never at a branch name.
- **Never a relative link** (`[ADR](docs/adr/…)`): a PR body resolves it against the PR's URL, so it
  breaks without an error.

**"Start here"** — at most three files per section, most critical first: the one the rest hangs off.
A mechanical section (a rename through call sites, a fixture, the CHANGELOG) gets none.

## Diagrams

Zero to N mermaid diagrams, where the reader is still building the model — Problem and Solution. One
earns its place for a request lifecycle (stdio vs HTTP, the OAuth exchange), a tool call through
handler, service and viz cache to the app, or a decision walk. Not next to a table that already says
it.

Label rules, or the block silently fails to render: quote every label (`A["…"]`), no `#`,
`&lt;`/`&gt;` for angle brackets, `<br/>` for a line break. Mermaid can't be rendered locally — say
in your report that the diagrams are unproven until the PR is opened.

## Screenshots

For a visual change to an MCP app: a capture of the app in a host, `Before` / `After` in a two-column
table for a restyle or a fix. Playwright's `test-results/` is gitignored and nothing in the repository
holds app captures, so an image has no blob URL — ask the user to drag it into the PR, or describe it
and skip the image. Never link a path that isn't committed at the head SHA.

## Voice

First person plural that owns decisions ("we chose … because"); problems labelled as problems;
`pro:` / `con:` bullets for a real choice; contractions; honest hedges ("so far", "in theory");
connectives that carry an argument. Avoid verdict-first aphorisms, verbless fragments, bold whole
sentences, passive voice where a "we" exists.

**On a rewrite, change no claim**: never touch a number, a `file:line`, a PR number, a link, a table
row or a heading. Everything comes from the diff, a command you ran, or the body being rewritten — a
plausible-sounding number is the one failure a reviewer cannot catch.

## Publishing

Write to a file and publish from it — never pass a body inline:

```bash
gh pr edit <n> --body-file "$TMPDIR/pr-<n>.md"
gh pr view <n> --json body --jq .body > "$TMPDIR/check-<n>.md"   # read back and diff
```

Expect a single trailing-newline difference. Write the file with a quoted heredoc (`<<'EOF'`) or the
Write tool so backticks and `$` survive. Every body ends with the attribution footer of the agent that
wrote it.

## Finishing

Report: the title, whether a Solution part was warranted, where each diagram went, the caveats
raised, which Tests rows survived and why, and the read-back result, plus the body's line count and
what the cut pass removed.
