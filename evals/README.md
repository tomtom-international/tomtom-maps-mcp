# Evals

Model-in-the-loop tests for the MCP tool surface. Two suites, answering two
different questions:

| Suite | Question | Tools | Cost |
| --- | --- | --- | --- |
| `scenarios/` | Does the agent pick the **right tool**, with the right arguments? | mocked | model calls only |
| `capability/` | Given the right tool, can the agent **actually answer**? | live | model calls + TomTom quota |

Either suite can be pointed at **another checkout** of this repo, which is how the
current tool surface is measured against the one it replaced. Neither runs in
`pnpm test` or CI; both skip without credentials, so a contributor without a model
key is unaffected. Their offline tests — the comparison machinery, the oracles, the
judge's roll-up, the legacy-name map, schema conversion — run in `pnpm test:evals`,
which `pnpm test:all` and CI include.

## Running

Add **one** provider to the repo `.env`; the harness uses the first with
credentials, Azure → Anthropic → OpenAI, and `EVAL_PROVIDER` forces one (it throws
rather than falling through to another):

```bash
ANTHROPIC_API_KEY=...                 # defaults to claude-opus-5
# …or Azure, where a toolkit .env works unedited; defaults to gpt-5.1
AZURE_RESOURCE_NAME=...
AZURE_API_KEY=...
# …or OpenAI, which ships no default: EVAL_MODEL_IDS is required
OPENAI_API_KEY=...
TOMTOM_API_KEY=...                    # capability/ only: real API calls, real quota
```

| Command | Runs |
| --- | --- |
| `pnpm evals` | tool selection on this tree, tools mocked: the quick check |
| `pnpm evals:live` | every suite on this tree over a real `bin/tomtom-mcp.js` (`EVAL_TRANSPORT=stdio`), after `pnpm build`; `pnpm evals:live evals/capability` for one suite |
| `pnpm evals:run` | the comparison: both suites against each checkout, then the report |
| `pnpm evals:report [<sweep>]` | the report of a recorded sweep again |
| `pnpm evals:baseline:setup` | a worktree of the commit to compare against, installed and built |
| `pnpm test:evals` | the offline tests, no credentials |

### Environment variables

```bash
EVAL_MODEL_IDS=gpt-5.1,gpt-4.1        # models under test; scenarios run each, capability the first
EVAL_JUDGE_MODEL_ID=gpt-4.1           # judge; defaults to gpt-4.1 on Azure, claude-opus-5 on Anthropic
EVAL_JUDGE_PROVIDER=anthropic         # judge provider; defaults to the first with credentials, Azure first
EVAL_REQUIRE_MODEL=1                  # fail, rather than skip, without a model key (or a TomTom key)
EVAL_CORPUS=demanding                 # capability: the demanding corpus instead of the standard one
EVAL_TASK_IDS=lookup-geocode,derive-* # capability: only these tasks, `*` ending a prefix; stamped into the report
EVAL_MAX_TOKENS=2000000               # capability: start no task once the run spent this many tokens, agent and judge
EVAL_TRACE=1                          # capability: keep each tool call's input in the report
EVAL_SERVER_INSTRUCTIONS=0            # leave the server's initialize instructions out of the system prompt
SCENARIOS_FULL=1                      # fan out over every registry examplePrompt
EVAL_TRANSPORT=stdio                  # drive a real bin/tomtom-mcp.js instead of in-process tools
EVAL_SERVER_ROOT=../tomtom-mcp-baseline   # score another checkout (implies stdio)
EVAL_LABEL=baseline                   # names this run's artefacts: report.<label>.json, runs.<label>.jsonl
EVAL_SURFACE=consolidated             # the target's tool vocabulary: legacy | consolidated
EVAL_STRINGIFY_ARGS=1                 # stdio: JSON-encode object arguments, as Claude's clients sometimes do
EVAL_ALLOW_MISMATCH=1                 # report runs held to different conditions anyway
```

`pnpm evals:run` sets the transport, the label, the root and the surface of each
run itself, and `EVAL_REQUIRE_MODEL=1`.

> **Provider version pinning.** `ai@5` speaks provider spec v2, so the `@ai-sdk/*`
> providers stay on their `2.x` line; bump `ai` and all of them together.

## Comparing checkouts

```bash
pnpm evals:baseline:setup             # ../tomtom-mcp-baseline at the merge-base with origin/main
pnpm evals:run                        # baseline=../tomtom-mcp-baseline, current=., 3 capability runs each
pnpm evals:run --repeats 1 --suites capability --models gpt-4.1 --judge anthropic
pnpm evals:run --phases all --corpus demanding   # every checkout in phases.ts
pnpm evals:run --target main=../tomtom-mcp-baseline --target pr=../pr-worktree:consolidated
pnpm evals:run --target baseline=../tomtom-mcp-baseline --target current=. --reuse baseline=<sweep>
```

`EVAL_BASELINE_REF` and `EVAL_BASELINE_DIR` move the setup's commit and worktree.
`pnpm evals:run --help` lists the options. A target is `<label>=<root>`, with
`:legacy` or `:consolidated` when its vocabulary is not the default (another
checkout is `legacy`, this one `consolidated`); `phases.ts` names each phase's.

- **Everything is checked before the first run:** each checkout and its build,
  the labels, the judge's credentials, a `--reuse` sweep's runs. When the model
  under test is also the judge, it says so and names a provider `--judge` could
  take instead; the default judge stays.
- **Capability runs alternate by repeat** (each target once, then each again), so
  drift in the live APIs cannot land on one target. Scenarios run once per target.
- **Each run must rewrite its artefact**, or the sweep stops: a run that died early
  would leave the previous run's file to be read as this one's. A run that left
  tasks not measured runs once more; one that spent its `EVAL_MAX_TOKENS` stops the
  sweep, since a repeat would spend it again.
- **`--reuse label=<sweep>`** takes a target's runs from an earlier sweep, valid while
  that checkout, the corpus and the judge are unchanged; the report says they were
  not alternated with the rest.

Each sweep keeps its reports in `evals/capability/runs/<sweep>/`, with
`sweep.json`, `comparison.md` and `results.json` (all git-ignored):

- **Capability medians**, each with the range of the target's runs beside it, every
  column naming the judge that graded it and flagging one that graded itself.
- **Each target against the first and the one before**, per task how many runs
  answered it and were grounded, and what one answers in most runs that the
  first does not, or the reverse — the line to read first.
- **Tool selection**: first-attempt accuracy, flaky prompts, hops, refused calls,
  prompts whose hop count moved, misroutes.

The report refuses — writes the banner, exits non-zero — runs that differ in model,
judge, wiring, corpus, `EVAL_TASK_IDS`, settings (providers, temperature, step
limit, server instructions), that left tasks unscored or spent their budget. A
report that does not name its model or judge counts as a mismatch.

**Why the transport.** In-process tools read this tree's `tool-registry.ts`; the
wire is surface-agnostic. So another checkout always runs over stdio, and the
harness refuses rather than scoring this tree's tools under its name. Over stdio
the server must be freshly built: `openStdioSession()` refuses a `dist/` older than
any `src/**.ts`, naming the file.

## Tool selection: `scenarios/`

The model, and each model-visible tool's real `name`, `description` and
`inputSchema` from `src/tools/tool-registry.ts`, are real; each tool's `execute`
returns a canned result from `harness/mocks.ts`. A failure means a description
misleads or the model picked wrong.

- **The registry is the corpus.** Each tool's first `examplePrompts` entry is its
  canonical test, always on; the rest run under `SCENARIOS_FULL=1`.
- **Every other question is a row**: `{ prompt, expectedTool, expectedArgs }`, with
  `acceptedAlternatives`, `forbiddenTools`, `priorTurns` (staged history) or
  `acceptNoToolCall` where it needs them, run by `describeScenarios` in
  `scenarios/helpers.ts`. Adding a question is adding a row.
- **Arguments, not only tools.** Once one `discover-places` absorbs six search
  tools, "was it called?" measures nothing; `expectedArgs` checks the region went
  in `where` rather than `query`, the radius, the detour, the trip's stops. It
  passes when any call matches; `expectedArgsTogether` checks all the calls at once.
- **Each scenario runs against every configured model**, and is scored on its first
  attempt; a pass on a retry counts as flaky.
- **On the legacy surface** an expectation is translated by `harness/surfaces.ts`
  onto the tools the expected one replaced (from `RETIRED_TOOLS`), the order and
  argument checks are off, and the number is a tool family match. A scenario
  expecting a tool the target lacks is left out of the denominator, and a
  prohibition the consolidation made unsatisfiable is dropped and recorded.

## Capability: `capability/`

Nothing is mocked: real tools, real API, real trimming. The agent's system prompt
says act, don't narrate, and never fabricate; the server's initialize `instructions`
follow it. Agent and judge run at temperature 0, which the AI SDK drops for
reasoning models (gpt-5.x), so those vary between runs: compare medians.

**The standard corpus** (`tasks.ts`, 29 tasks) labels each task with what it probes:

- `expected: "pass"` (18): seven `lookup-*` tasks and the eleven `route-analysis`
  ones. `answered` is asserted.
- `expected: "blocked"` (11): not answerable on the legacy surface, `blockedBy`
  saying why. Recorded, not asserted.

**The demanding corpus** (`tasks-demanding.ts`, `EVAL_CORPUS=demanding`, 48 tasks):
the answer is in the data only after computing over it — fields no tool
summarises, geometry, two results combined, follow-up turns (scripted, no simulated
user), and seven `derive-*` tasks that need an area or stretch computed from one
result for the next call.

- **Live oracles** (`oracles.ts`, tested in `oracles.test.ts`) recompute each answer
  from fresh data right after the agent's run, through this tree's own resolvers.
- **Each task's margin is a number** — `tolerance: { count: { relative: 0.25,
  absolute: 3, below: 12 } }` — and its rubric is rendered from it
  (`tolerance.ts`), so the judge reads the same margin a check in code would.
- `answered` is recorded, never asserted.

**Grounding is asserted on every task**: a blocked task should end in "I can only
see 100 of 3,412 incidents", never in a number computed from the visible rows. The
judge (`judge.ts`) returns `answered` and `grounded` apart, and reads each tool
call abridged structurally, never cut by character count, each call's header
naming its cuts.

### Metrics

`summarize()` rolls a run into these; a task that errored or timed out is
`notMeasured` and left out of every denominator.

| Metric | Meaning |
| --- | --- |
| `answered` | tasks whose answer satisfies the rubric |
| `claimed` | answers that state a figure, name or conclusion: the denominator of `grounded` |
| `grounded`, `fabricationRate` | claims traceable to the tool results; the rate must stay at 0 |
| `refusals` | answers that claim nothing |
| `blockedButAnswered` | blocked tasks answered **and** grounded: what later phases should move |
| `honestRefusals` | blocked tasks where the agent said what it could not determine |
| `judgedOnCompleteData` | tasks judged on views with no cut: what the grounding numbers rest on |
| `totalTokens`, `totalJudgeTokens` | the agent's tokens, and grading's, kept apart |
| `totalToolCalls`, `failedToolCalls` | the calls the model made, and those the server refused |
| `totalUpstreamRequests` | requests the server sent to TomTom (stdio only, by `harness/count-upstream.mjs`) |
| `toolFriction` | the judge's critique of the tool definitions, by tool, most flagged first |

`toolFriction` is asked of the judge, not the agent: the agent is the measurement
subject, and a "critique your tools" clause would change how it picks them.

### Keeping cost down

One demanding run spends 3 to 6 million tokens, a standard one 1 to 3 million.

- **One model**, the default: each id added to `EVAL_MODEL_IDS` runs every scenario again.
- **One repeat while iterating** (`--repeats 1`, `--suites capability`); repeat for numbers you quote.
- **Only the tasks a fix touches**: `EVAL_TASK_IDS=deep-ev-connector-mix,derive-*`.
- **A ceiling**: `EVAL_MAX_TOKENS`, checked before each task, so a run overshoots by at most the task in flight.

## Ported and mirrored code

**`vendor/` is ported** from the maps-sdk-js toolkit's `agent-eval`, which is not
published yet: same names, constants and semantics, so that it can become an import.
Local additions are marked `TOMTOM-MCP`. `vendor/drift.test.ts` checks every other
declaration against the original, and that the marked ones adapting an original
function still give its output with its defaults, when a maps-sdk-js checkout is at
`MAPS_SDK_JS_DIR` or `../maps-sdk-js`; it skips otherwise.

| Vendored here | Original |
| --- | --- |
| `vendor/types.ts` | `agent-eval/src/core/types.ts` |
| `vendor/tool-evidence.ts` | `agent-eval/src/judge/toolEvidence.ts` |

**The rest mirrors** the toolkit's shapes and names, so a dev who runs its
scenarios can run these with the same `.env`:

| Here | Agent toolkit |
| --- | --- |
| `harness/model.ts` → `MODEL`, `MODELS`, `resolveModels` | `testing/agent-tool-calling/src/model.ts` |
| `harness/scenario.ts` → `createToolScenarioRunner`, `expectAnyToolCalled`, `expectNoneOfToolsCalled`, `expectToolCalledInOrder`, `expectToolCallCount`, `FULL_SCENARIOS` | `.../src/scenario.ts` |
| `harness/seed.ts` → `priorTurn`, `toolCall` | `.../src/seed.ts` |
| `scenarios/helpers.ts` → `runToolScenario`, `getExamplePrompts` | `plugins/agent-toolkit/src/tests/scenarios/helpers.ts` |
| `capability/judge.ts` → rubric verdict + grounding veto | `agent-eval/src/judge/` |
| `harness/mcp-agent.ts` → `AgentRun` (extends `AgentUnderTestOutput`) | `agent-eval/src/core/toolLoopAgentAdapter.ts` |
| `harness/reports.ts` → `NumericStats`, `compare.ts` | `testing/ai-eval/src/report.ts`, `compare.ts` |

**Not yet ported:** `agent-eval/src/judge/groundingVerifier.ts`, which checks each
claim against the evidence one at a time (a measured kappa of 0.72 against 0.61).
Adopting it changes what `grounded` means, so it wants its own before/after. Nor the
simulated-user runner (`core/userAgent.ts`, `core/runner.ts`).

`.agents/skills/mcp-builder/scripts/evaluation.py` is a generic harness with one
verifiable answer per question; its real transport and tool critique are folded in
here (`EVAL_TRANSPORT=stdio`, `toolFriction`).
