---
name: tomtom-mcp-review
description: Review a branch or pull request of the TomTom MCP server with a fresh subagent that never saw the change being written. It sweeps the diff against CODING_GUIDELINES.md, CONTEXT.md, the ADRs and Adding_new_tools.md, searches the repository for helpers and types to reuse instead of adding, finds missing test coverage (sibling unit tests, the tool-input checks, the API-key leak guard, the stdio and HTTP tool scripts, the e2e specs), inconsistencies between code, tool descriptions, README, manifest, CHANGELOG and the PR description, and likely bugs — stdout writes, API keys crossing sessions or reaching results, coordinate order, response_detail and geometry — as one- or two-line comments. On a PR it posts them as one review with inline comments; on a local branch the main agent verifies and fixes them. Use when the user says "review PR #320", "review this PR", "review my branch", "review feat/x", pastes a tomtom-international/tomtom-maps-mcp PR link, or asks for a second pair of eyes, a bug hunt or a reuse sweep. Preflight gates the working diff before a commit; this reviews what a branch or PR changes.
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

The commands are POSIX shell: Git Bash on Windows.

## Step 1: Resolve the target

| Invoked with | Mode | Review root |
|---|---|---|
| `#N`, `N`, or a `github.com/tomtom-international/tomtom-maps-mcp/pull/N` link | **PR** | a worktree at the PR head |
| a branch name, `--base <ref>` optional | **Local** | a worktree, or in place when it is the current branch |
| nothing | **Local**, the current branch, uncommitted changes included | in place |

Refuse a PR link to any other repository. Then set up the inputs in one scratch directory:

```bash
REVIEW_DIR=$(mktemp -d -t tomtom-mcp-review)
cp .agents/skills/tomtom-mcp-review/docs/reviewer.md "$REVIEW_DIR/"
# PR mode
gh pr view "$N" --json number,title,body,url,baseRefName,headRefOid > "$REVIEW_DIR/pr.json"
BASE_REF=origin/$(gh pr view "$N" --json baseRefName --jq .baseRefName)
HEAD_SHA=$(gh pr view "$N" --json headRefOid --jq .headRefOid)
git fetch origin "${BASE_REF#origin/}" "pull/$N/head"
# Local mode: BASE_REF=${base:-origin/main}; HEAD_SHA=$(git rev-parse <branch>); git fetch origin main
BASE=$(git merge-base "$BASE_REF" "$HEAD_SHA")
git diff -U3 "$BASE" "$HEAD_SHA" > "$REVIEW_DIR/diff.patch"
git worktree add --detach "$REVIEW_DIR/tree" "$HEAD_SHA"   # skip when reviewing in place
```

- **The brief is copied** because a checkout, stash or branch switch in your tree during the review
  would otherwise take it away from a reviewer still reading it.
- **`pr.json` carries the title and description**, which the reviewer holds the diff to.
- **`pull/$N/head`** fetches a PR from a fork as readily as one from a branch here.
- **Base of a stacked PR** is its `baseRefName`, another feature branch, so the diff is that PR's own
  slice. For a local branch in a stack, the user names `--base`.
- **Reviewing in place**, diff against the working tree instead (`git diff -U3 "$BASE"`) and list
  `git ls-files --others --exclude-standard` into `$REVIEW_DIR/untracked.txt`: the subagent reads those
  in full.
- **In PR mode, collect the review threads** so a rerun doesn't repeat itself:

```bash
gh api graphql -F n="$N" -f query='query($n: Int!) { repository(owner: "tomtom-international", name: "tomtom-maps-mcp") {
  pullRequest(number: $n) { reviewThreads(first: 100) { nodes { isResolved isOutdated path line
    comments(first: 3) { nodes { author { login } body } } } } } } }' > "$REVIEW_DIR/threads.json"
```

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
Base: <BASE>   Head: <HEAD_SHA, or "working tree">
Inputs in <REVIEW_DIR>: diff.patch, plus pr.json (the PR title and description), threads.json,
untracked.txt where present.
Paths: <all, or the area list when split>
Write your findings to <REVIEW_DIR>/findings.json.
```

**A large diff splits by area.** Past roughly 3,000 changed lines, launch one reviewer per area in
parallel, each with its own `Paths` and its own `findings-<area>.json`:

| Area | Paths |
|---|---|
| server | `src/` outside `src/apps/`, `bin/`, `scripts/` |
| apps | `src/apps/`, `ui/`, `e2e/` |
| surfaces | everything else: docs, `manifest-binary.json`, `tests/`, CI, the skills |

Reuse stays in scope for each: a reviewer of the apps still searches the server tree.

## Step 3: Verify the findings

A subagent can be wrong. Before anything leaves the session, open each finding's anchor in the review
root and check the claim holds:

- **Drop** one whose evidence doesn't exist: the "duplicate" does something else, the "missing" test is
  there, the bug's scenario can't happen.
- **Drop** one an open thread in `threads.json` already raises, or a resolved one settled, unless the
  code regressed since.
- **Tighten** a vague one into the defect and the fix, and **merge** duplicates into the first, naming the
  other places.

Rewrite `findings.json` with what survives. Keep the summary line true to it.

## Step 4: Deliver

### PR mode: post one review

```bash
node .agents/skills/tomtom-mcp-review/scripts/buildReview.mjs \
  --diff "$REVIEW_DIR/diff.patch" --commit "$HEAD_SHA" "$REVIEW_DIR"/findings*.json > "$REVIEW_DIR/review.json"
gh api "repos/tomtom-international/tomtom-maps-mcp/pulls/$N/reviews" --method POST --input "$REVIEW_DIR/review.json"
```

- The script turns each finding into an inline comment on its line, or moves it into the review body
  when GitHub couldn't anchor it there (outside every hunk, or a finding with no line). One bad anchor
  otherwise fails the whole review with a 422.
- **The repository is public**, and outside contributors read the review: show the comments first and
  post once the user confirms, unless they already said to post.
- **The event is always `COMMENT`.** Approving or requesting changes is a person's call.
- **No findings** posts nothing: tell the user the review came back clean, and what it couldn't check.

### Local mode: hand the findings to the main agent

Process each surviving finding, most severe first. On the **current branch**, fix what needs no
invented intent, the same split as preflight: a bug with a clear fix, a duplicate to replace by the
existing helper, a missing test of stated behaviour, a stale doc line. Report the rest as
`path:line` and the comment. On **any other branch**, report all of them and edit nothing.
Run `tomtom-mcp-preflight` after fixing, before any commit.

## Step 5: Clean up and report

```bash
git worktree remove --force "$REVIEW_DIR/tree"; rm -rf "$REVIEW_DIR"
```

Lead with the outcome: the review link and its count of blocking, suggestion and nit comments, or the
fixes made and the findings left. Then name what the reviewer couldn't check — how an MCP app looks in
a host, a live API answer nobody called — and the findings Step 3 dropped, one line each, so the user
can overrule.
