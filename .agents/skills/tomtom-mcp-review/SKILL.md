---
name: tomtom-mcp-review
description: Review a branch or pull request of the TomTom MCP server with a fresh subagent that never saw the change being written. It sweeps the diff against CODING_GUIDELINES.md, CONTEXT.md, the ADRs and Adding_new_tools.md, searches the repository for helpers and types to reuse instead of adding, finds missing test coverage (sibling unit tests, the tool-input checks, the API-key leak guard, the stdio and HTTP tool scripts, the e2e specs), inconsistencies between code, tool descriptions, README, manifest, CHANGELOG and the PR description, and likely bugs — stdout writes, API keys crossing sessions or reaching results, coordinate order, response_detail and geometry — as one- or two-line comments. A docs-portal PR the description links (tomtom-internal/devportal-documentation) is reviewed with it, against the implementation, and gets its own review. On a PR it shows them, then posts them as one review with inline comments once the user confirms; on a local branch the main agent verifies and fixes them. Locally it can also review whole files instead of a diff, an area or the entire repository, and loop: fix the clearly agreeable findings, commit, review again, until a round leaves nothing with an obvious fix. Use when the user says "review PR #320", "review this PR", "review my branch", "review feat/x", "review the whole of src/tools", "review in a loop", "review until clean", pastes a tomtom-international/tomtom-maps-mcp PR link, or asks for a second pair of eyes, a bug hunt or a reuse sweep. Preflight gates the working diff before a commit; this reviews what a branch or PR changes, or whole files.
---

A second reviewer for a finished change. The author's agent knows what the change *meant* to do, so it
reads past what the diff actually does; a **fresh subagent** sees only the diff, the PR description
and the repository. This skill is the main agent's procedure; the subagent's brief is
[`docs/reviewer.md`](docs/reviewer.md).

- **Preflight is not this.** [`tomtom-mcp-preflight`](../tomtom-mcp-preflight/SKILL.md) runs the CI
  gates on your working diff before a commit. A review runs no gate, since CI does, and judges the change.
- **The repository decides.** Every comment rests on [`CODING_GUIDELINES.md`](../../../CODING_GUIDELINES.md),
  [`CONTEXT.md`](../../../CONTEXT.md), an [ADR](../../../docs/adr/README.md),
  [`Adding_new_tools.md`](../../../Adding_new_tools.md), or a traced failing scenario — never on taste.

The commands are POSIX shell: Git Bash on Windows. **Run each `gh` command, and `fetchPr.mjs`, in a
shell call of its own**, with no redirect, pipe or `$(...)`. Claude Code's sandbox hides `gh`'s token,
and `.claude/settings.json` takes these out of it only when the call holds nothing else.

## Step 1: Resolve the target

| Invoked with | Mode | Review root |
|---|---|---|
| `#N`, `N`, or a `github.com/tomtom-international/tomtom-maps-mcp/pull/N` link | **PR** | a worktree at the PR head |
| a branch name, `--base <ref>` optional | **Local** | a worktree, or in place when it is the current branch |
| nothing | **Local**, the current branch, uncommitted changes included | in place |
| `--all`, or `--all <path>…` | **Local**, whole files: every tracked file, or those under the paths | in place |

Add `--loop` to a Local target on the current branch for **loop mode**, which Step 4 describes. Refuse
it with a PR, another branch, or a dirty tree.

Refuse a PR link to any other repository. Then set up the inputs in one scratch directory:

```bash
REVIEW_DIR=$(mktemp -d "${TMPDIR:-/tmp}/tomtom-mcp-review.XXXXXX")
cp .agents/skills/tomtom-mcp-review/docs/reviewer.md "$REVIEW_DIR/"
```

In PR mode, fetch the PR with `$TARGET`, what the user gave: `#N`, `N` or a link. The script writes
`pr.json`, `threads.json` and `reviews.md`, and prints `N`, `BASE_REF`, `HEAD_SHA` and `DOCS_PRS` for
the rest:

```bash
node .agents/skills/tomtom-mcp-review/scripts/fetchPr.mjs "$TARGET" "$REVIEW_DIR"
```

`DOCS_PRS` lists the docs-portal PRs on the description's `Docs portal:` line
([`CODING_GUIDELINES.md`](../../../CODING_GUIDELINES.md) § 10); one cited anywhere else is evidence, not a
sibling. Each gets `docs-<N>/` with the same three files, its `diff.patch`, and `tree/`, a sparse checkout of
the MCP pages at its head. With no access, `docs-<N>/unavailable.txt` says why and the review goes on
without it. In local mode, look the sibling up by its branch and fetch it alone:

```bash
gh pr list -R tomtom-internal/devportal-documentation --head tomtom-maps-mcp/<branch> --json number
```

```bash
node .agents/skills/tomtom-mcp-review/scripts/fetchPr.mjs --docs <number> "$REVIEW_DIR"
```

```bash
git fetch origin "${BASE_REF#origin/}" "pull/$N/head"
# Local mode: BASE_REF=${base:-origin/main}; HEAD_SHA=$(git rev-parse <branch>); git fetch origin main
BASE=$(git merge-base "$BASE_REF" "$HEAD_SHA")
git diff -U3 "$BASE" "$HEAD_SHA" > "$REVIEW_DIR/diff.patch"
git worktree add --detach "$REVIEW_DIR/tree" "$HEAD_SHA"   # skip when reviewing in place
```

- **The brief is copied** because a checkout, stash or branch switch in your tree during the review
  would otherwise take it away from a reviewer still reading it.
- **`pr.json` carries the title and description**, which the reviewer holds the diff to.
- **`threads.json` and `reviews.md`** keep a rerun from repeating itself: each review thread with its
  first comment and its latest three, where a "fixed in" reply lands, and the bodies of earlier agent
  reviews, which hold the findings no line could anchor.
- **`pull/$N/head`** fetches a PR from a fork as readily as one from a branch here.
- **Base of a stacked PR** is its `baseRefName`, another feature branch, so the diff is that PR's own
  slice. For a local branch in a stack, the user names `--base`.
- **Reviewing in place**, diff against the working tree instead (`git diff -U3 "$BASE"`) and list
  `git ls-files --others --exclude-standard` into `$REVIEW_DIR/untracked.txt`: the subagent reads those
  in full.
- **Whole files** diff from the empty tree, so every line is a changed line, generated and vendored files
  left out. Write the paths in place of `.` when the user named some:

```bash
git diff -U3 4b825dc642cb6eb9a060e54bf8d69288fbee4904 -- . ':!pnpm-lock.yaml' ':!src/version.ts' \
  ':!skills-lock.json' ':!veracode-pipeline-scan-baseline-file.json' ':!.agents/skills/mcp-builder' \
  > "$REVIEW_DIR/diff.patch"
```

  `4b825dc…` is git's empty tree (`git hash-object -t tree /dev/null`), and `BASE` from then on. It
  covers tracked files only, so write no `untracked.txt`. The whole repository runs to tens of
  thousands of lines, so read `git diff --shortstat` on it before Step 2, and name the paths when you
  can.

## Step 2: Launch the reviewer

Start a **new** subagent with your agent's subagent tool (Claude Code's `Agent`, Cursor's `Task`),
general-purpose type, read-only where the tool offers it. Never resume or fork one that has this
conversation: its value is that it doesn't. Pass this prompt and nothing else — no summary of the
change and no opinion of it. The PR description reaches the reviewer through `pr.json`, as the
author's claims to check against the diff.

```text
You are reviewing a change to the TomTom Maps MCP server. Read
<REVIEW_DIR>/reviewer.md and follow it exactly.
Review root: <REVIEW_DIR/tree, or the repo root in place>
Base: <BASE, "(the empty tree: whole files)" after it when so>   Head: <HEAD_SHA, or "working tree">
Inputs in <REVIEW_DIR>: diff.patch, plus pr.json (the PR title and description), threads.json,
reviews.md, declined.json, untracked.txt where present, and docs-<N>/ for each docs-portal PR in DOCS_PRS.
Paths: <all, or the area list when split>
Write your findings to <REVIEW_DIR>/findings.json.
```

**A large diff splits by area.** Past roughly 3,000 changed lines, launch one reviewer per area in
parallel, each with its own `Paths` and its own `findings-<area>.json`:

| Area | Paths |
|---|---|
| server | `src/` outside `src/apps/`, `bin/`, `scripts/` |
| apps | `src/apps/`, `ui/`, `e2e/` |
| surfaces | everything else: docs, `manifest-binary.json`, `tests/`, CI, the skills, and every `docs-<N>/` |

Reuse stays in scope for each: a reviewer of the apps still searches the server tree. A whole-file review
splits further, by the directories under each area (`src/tools/`, `src/services/`, `src/apps/<app>/`)
until each slice is near that size; say how many reviewers that makes, and ask before launching more
than about ten.

## Step 3: Verify the findings

A subagent can be wrong. Before anything leaves the session, open each finding's anchor in the review
root and check the claim holds:

- **Drop** one whose evidence doesn't exist: the "duplicate" does something else, the "missing" test is
  there, the bug's scenario can't happen.
- **Drop** one an open thread in `threads.json` or an earlier review in `reviews.md` already raises, a
  resolved thread settled, or an earlier loop round declined in `declined.json`, unless the code
  regressed since.
- **Tighten** a vague one into the defect and the fix, and **merge** duplicates into the first, naming the
  other places.

Rewrite `findings.json` with what survives. Keep the summary line true to it. A docs-portal finding is
checked the same way: its page in `docs-<N>/tree/`, the code it cites in the review root, and the threads
in `docs-<N>/threads.json`; rewrite `docs-<N>/findings.json`.

## Step 4: Deliver

### PR mode: post one review

```bash
node .agents/skills/tomtom-mcp-review/scripts/buildReview.mjs \
  --diff "$REVIEW_DIR/diff.patch" --commit "$HEAD_SHA" "$REVIEW_DIR"/findings*.json > "$REVIEW_DIR/review.json"
```

```bash
gh api "repos/tomtom-international/tomtom-maps-mcp/pulls/$N/reviews" --method POST --input "$REVIEW_DIR/review.json"
```

- The script turns each finding into an inline comment on its line, or moves it into the review body
  when GitHub couldn't anchor it there (outside every hunk, or a finding with no line). One bad anchor
  otherwise fails the whole review with a 422.
- **The repository is public**, and outside contributors read the review: show the comments first and
  post once the user confirms, unless they already said to post.
- **The event is always `COMMENT`.** Approving or requesting changes is a person's call.
- **No findings** posts nothing: tell the user the review came back clean, and what it couldn't check.

Then one review per docs-portal PR, on its own diff and head, in its own repository:

```bash
node .agents/skills/tomtom-mcp-review/scripts/buildReview.mjs \
  --diff "$REVIEW_DIR/docs-<N>/diff.patch" --commit "<headRefOid from docs-<N>/pr.json>" \
  "$REVIEW_DIR/docs-<N>/findings.json" > "$REVIEW_DIR/docs-<N>/review.json"
```

```bash
gh api "repos/tomtom-internal/devportal-documentation/pulls/<N>/reviews" --method POST --input "$REVIEW_DIR/docs-<N>/review.json"
```

That repository is internal, so its review may quote the pages; the public PR's review never does.

### Local mode: hand the findings to the main agent

Process each surviving finding, most severe first. On the **current branch**, fix what needs no
invented intent, the same split as preflight: a bug with a clear fix, a duplicate to replace by the
existing helper, a missing test of stated behaviour, a stale doc line. Report the rest as
`path:line` and the comment. A docs-portal finding is fixed in the sibling through
[`tomtom-mcp-docs-update-pr`](../tomtom-mcp-docs-update-pr/SKILL.md) Steps 4 and 5. On **any other branch**, report all of them and edit nothing.
Run `tomtom-mcp-preflight` after fixing, before any commit.

### Loop mode: fix, commit, review again

Local mode round after round, on the current branch. It commits locally, and pushes and posts nothing.

1. **Start clean.** Refuse while `git status --porcelain --untracked-files=no` lists anything, since a
   round's commit would take the user's own work with it; ask them to commit or stash it first.
   Untracked files can stay, since a round stages its fixes by name. Keep one `$REVIEW_DIR` for every
   round, with a `declined.json` that starts as `[]`.
2. **Review**: Steps 1–3 with a new subagent, in that `$REVIEW_DIR` rather than a new `mktemp`:
   rewrite `diff.patch` with `HEAD_SHA=$(git rev-parse HEAD)` read again. Write no `untracked.txt`:
   every round's fixes are committed before the next, so an untracked file is the user's.
   - A diff review keeps its first base, so each round reads the fixes within the whole change.
   - A whole-file review narrows from the second round to every file the last round's commit touched,
     under the paths the user named or not, since the rest has been reviewed already.
3. **Fix** what Local mode fixes, by the same split. Append every finding you leave to `declined.json`,
   with a `reason` saying why its fix isn't obvious: later rounds skip it.
4. **End the loop** when a round fixed nothing.
5. **Commit.** Run `tomtom-mcp-preflight`'s commit tier on the fixes, and revert and decline a fix that
   breaks a gate with no obvious repair. The commit gate opens once per session, but every round's
   commit still needs preflight. Stage the fixed paths by name and commit once per round with
   `--signoff` ([`CONTRIBUTING.md`](../../../CONTRIBUTING.md)): a conventional subject
   ([`tomtom-mcp-pr-description`](../tomtom-mcp-pr-description/SKILL.md) § *The title*) saying what the
   fixes do, a body line per finding fixed. Then back to 2.

End it early, too:

- **After five rounds**, even with fixes still coming: a fresh reviewer can always find one more nit.
- **When a fix undoes an earlier round's**: revert it, decline both, and stop. Two reviewers disagree,
  and that is the user's call.

## Step 5: Clean up and report

```bash
git worktree remove --force "$REVIEW_DIR/tree"; rm -rf "$REVIEW_DIR"
```

Lead with the outcome: each review link — the PR's and every docs-portal PR's — and its count of
blocking, suggestion and nit comments, or the fixes made and the findings left. Then name what the reviewer couldn't check — how an MCP app looks in
a host, a live API answer nobody called — and the findings Step 3 dropped, one line each, so the user
can overrule. A loop reports the rounds it ran and why it ended, each commit's short SHA and subject, and
`declined.json` as `path:line`, the comment and its reason.
