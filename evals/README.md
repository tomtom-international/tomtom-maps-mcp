# Evals

Model-in-the-loop tests for the MCP tool surface. Two suites, answering two
different questions:

| Suite | Question | Tools | Cost |
| --- | --- | --- | --- |
| `scenarios/` | Does the agent pick the **right tool**? | mocked | model calls only |
| `capability/` | Given the right tool, can the agent **actually answer**? | live | model calls + TomTom quota |

Either suite can be pointed at a **different checkout** of this repo, which is how
the current tool surface is measured against the one it replaced — see
[Comparing against the previous tool surface](#comparing-against-the-previous-tool-surface).

Neither runs as part of `pnpm test`. Both are gated on credentials and skip
silently without them, so a contributor without Azure access is unaffected.

## What is real vs. mocked

**`scenarios/`** — the whole selection path is real; only side effects are stubbed.

- **Real:** the model call, and every tool's real `name`, `description` and
  `inputSchema`, read straight from `src/tools/tool-registry.ts`. A failure means
  a description is misleading or the model genuinely picked wrong.
- **Mocked:** each tool's `execute`, via `harness/mocks.ts`. Tools without a
  canned result return `{ success: true }`. No TomTom quota is spent.

**`capability/`** — nothing is mocked. Real tools, real API, real trimming. That
is the point: the question is whether the data that reaches the model is enough
to answer with.

The agent under test is built in `harness/mcp-agent.ts`: an AI SDK tool loop over
`DEFAULT_TOOLS`. The MCP server is a tool *provider*, not an agent, so the eval
has to supply the loop. Tools are wired in-process **by default** — same names, descriptions and schemas
as `register.ts` feeds to `registerAppTool`, but with a swappable `execute` and no
subprocess per scenario.

Set **`EVAL_TRANSPORT=stdio`** to run instead against a real `bin/tomtom-mcp.js`
subprocess driven through the MCP SDK client. That covers what in-process wiring
cannot: JSON-Schema conversion of the Zod shapes, argument coercion inbound, and
the `{ content: [{ type: "text", text }] }` envelope outbound. Until this existed
nothing exercised *LLM + real serialization* — `tests/test-stdio-tools.js` drives
the transport with no model, and the in-process evals drive the model with no
transport.

Scores should **match** between the two modes. A divergence is itself the finding:
something about the MCP boundary is changing what reaches the model. `report.json`
records which `mode` produced it, since the two are not interchangeable.

`harness/transport.test.ts` is the cheap half of this and needs **no model key** —
it asserts the wire surface equals `DEFAULT_TOOLS`, that app-internal tools stay
hidden from a non-app client, and that every schema survives the round trip. It
runs under `EVAL_TRANSPORT=stdio` and guards against the in-process modes drifting
from what real clients see.

> Transport mode needs a **fresh `pnpm build`**. A stale `dist/` is the dangerous
> case — everything runs and you get a clean report describing a tool surface that
> no longer exists — so `openStdioSession()` refuses to start when any `src/**.ts`
> is newer than the bundle, naming the offending file.

## Terminology

Two mechanisms, deliberately different:

**`vendor/` is PORTED CODE.** Files under `evals/vendor/` are copies of the
toolkit's, kept as close to the original as the language allows — same function
names, same constants, same semantics — so that when `agent-eval` is published
the file is deleted and the import redirected, rather than reconciled. Local
additions carry a `TOMTOM-MCP` marker and say why.

| Vendored here | Original |
| --- | --- |
| `vendor/types.ts` | `agent-eval/src/core/types.ts` |
| `vendor/tool-evidence.ts` | `agent-eval/src/judge/toolEvidence.ts` |

`vendor/tool-evidence.test.ts` is a characterisation suite over the port, so
swapping it for the real import is a change those tests either accept or object
to.

Porting `toolEvidence` was not a tidiness exercise. This repo grew its own
version and got it wrong twice — first slicing serialised JSON at 6,000
characters (cutting mid-token, so the judge scored what it could not parse as
fabrication), then abridging inside the budget (inventing omissions the data did
not have). The toolkit's own comment had the answer written down already: *"We do
not slice by length as we can cut a key… Otherwise, we collapse early, and
grounding pipeline flags all these claims as ungrounded."*

**The rest MIRRORS.** These files are this repo's own, written to the toolkit's
shape — same env vars, same exported names, same `ScenarioOutcome` contract:

| Here | Agent toolkit |
| --- | --- |
| `harness/model.ts` → `MODEL`, `MODELS`, `resolveAzureModels` | `testing/agent-tool-calling/src/model.ts` |
| `harness/scenario.ts` → `createToolScenarioRunner`, `expectAnyToolCalled`, `expectNoneOfToolsCalled`, `expectToolCalledInOrder`, `expectToolCallCount`, `FULL_SCENARIOS` | `.../src/scenario.ts` |
| `harness/seed.ts` → `priorTurn`, `toolCall` | `.../src/seed.ts` |
| `scenarios/helpers.ts` → `runToolScenario`, `getExamplePrompts` | `plugins/agent-toolkit/src/tests/scenarios/helpers.ts` |
| `capability/judge.ts` → rubric verdict + grounding veto | `agent-eval/src/judge/` |
| `harness/mcp-agent.ts` → `AgentRun` (extends `AgentUnderTestOutput`) | `agent-eval/src/core/toolLoopAgentAdapter.ts` |

A tool call is `{ name, input, output }` and usage is `{ inputTokens,
outputTokens }`, both straight from `vendor/types.ts`. This repo used to call the
first field `toolName` — a gratuitous difference that would have had to be
unpicked later.

So a dev who can run the toolkit's scenarios can run these with the same `.env`.

## Assertions

From `harness/scenario.ts`:

- `expectAnyToolCalled(run, ...names)` — passes if **any** was called (logical OR)
- `expectNoneOfToolsCalled(run, ...names)` — passes if **none** were
- `expectToolCalledInOrder(run, ...names)` — each strictly after the previous
  (proves a sequential flow, not a parallel batch)
- `expectToolCallCount(run, name, n)` — exact count
- `expectToolCalledWith(run, name, predicate)` — asserts the **arguments**. Passes
  when *any* call to the tool matches (same OR semantics as
  `expectAnyToolCalled`); the failure message lists every non-matching call with
  its actual arguments. Return a **string** from the predicate to supply your own
  reason — a bare `false` only says "something was wrong".
- `expectEveryToolCallWith(run, name, predicate)` — the same, but *every* call must
  match. For invariants ("no search asked for more than 100 results") rather than
  intent.

Scenario files reach `expectToolCalledWith` through the declarative
`expectedArgs` option:

```ts
await runToolScenario({
  expectedTool: "tomtom-area-search",
  prompt: "Find every bookshop inside Westminster",
  expectedArgs: {
    "tomtom-area-search": (input) =>
      String(input.query ?? "").toLowerCase().includes("westminster")
        ? "region was passed as the search subject (`query`)"
        : Boolean(input.polygon || input.boundingBox),
  },
});
```

**Why arguments matter as tools get wider.** Checking *which* tool was called is
the right question while the surface is one tool per endpoint. It stops being the
right question after phase 4: once one `discover-places` absorbs seven search
tools, "was discover-places called?" is trivially true and measures nothing, while
the real failure is a correctly-chosen tool called with the search *subject* in the
`where` scope ("restaurants") instead of the region ("Amsterdam"). Two scenarios in
`search.test.ts` already pin that distinction on today's surface, so the collapse
has a baseline to preserve rather than an assertion invented afterwards.

Success is asserted at the test level
(`expect(outcome.success, outcome.failureReason).toBe(true)`) so every failure
message names the failing model and lists the tools the agent actually called.

Each scenario runs against **every** configured model and passes only when all of
them route correctly.

## The prompt corpus lives in the registry

`scenarios/` reads its prompts from each tool's `examplePrompts` via
`getDefaultToolPrompts()` — the same accessor the registry's own unit tests use.
Adding a prompt to a `tool-registry.ts` row adds a test on the next run; there is
no second list to keep in sync. `tool-registry.test.ts` fails if any
model-visible tool has none.

Each tool gets one **canonical** test (the first registry prompt, always on) plus
an `it.each` over the rest behind `SCENARIOS_FULL=1`.

`forbiddenTools` is where the near-miss pairs are pinned down — the ones the
descriptions explicitly steer between: `nearby` vs `area-search`,
`routing` vs `reachable-range`, `dynamic-map` vs `data-viz`, and
`traffic` vs plotting incidents by hand.

## The capability benchmark

`capability/tasks.ts` is a corpus of 13 tasks, each labelled with the capability
it probes and whether it is answerable **today**:

- `expected: "pass"` (4 tasks) — answerable now. **Asserted**; a regression fails
  the build. Phase 0 must not move these.
- `expected: "blocked"` (9 tasks) — not answerable now, with `blockedBy` naming
  the exact reason (`capTrafficIncidents` truncating to 100 of thousands;
  `trimGeoJSONFeatureProperties` deleting `openingHours` and `categorySet`;
  `trimRoutingResponse` deleting `guidance` and `coordinates`). **Recorded, not
  asserted** — these are what phase 2 is supposed to unlock.

One thing is asserted for *every* task: **the agent must not fabricate.** A
blocked task should end in "I can only see 100 of 3,412 incidents", never in a
confident number computed from the visible rows. That is why the judge returns
`answered` and `grounded` separately — a subset presented as the whole scores
`grounded: false`, and the suite fails.

`summarize()` rolls this into the numbers to track across phases:

- **`fabricationRate`** — must stay at 0.
- **`blockedButAnswered`** — blocked tasks answered *and* grounded. The headline
  number phase 2 should move. Answering a blocked task ungrounded is a
  fabrication, not progress, so it deliberately does not count here.
- **`honestRefusals`** — blocked tasks where the agent said what it could not
  determine. High is good *today*: honest failure is the best available behaviour
  when the data was thrown away before the model saw it.
- **`totalTokens`** — the cost side of the ledger. Phase 2 should answer *more*
  for *fewer* tokens, since aggregates replace dumps.
- **`toolFriction`** — the judge's critique of the tool DEFINITIONS this run
  exposed, grouped by tool and sorted by how often each was flagged. One task
  complaining about `tomtom-nearby` is noise; the same complaint on four tasks is
  a description that needs rewriting. This is the work list for the tool-surface
  consolidation in phase 4 — a model telling you which of the nine overlapping
  search descriptions are ambiguous.

`toolFriction` is ported from the vendored mcp-builder harness
(`.agents/skills/mcp-builder/scripts/evaluation.py`), which asks the model for
`<feedback>` on tool names, parameters, and descriptions — the one thing that
harness had and this one didn't. It is asked of the **judge**, not the agent,
deliberately: mcp-builder asks the agent, which is the one that struggled, but our
agent is also the measurement subject, and a "critique your tools" clause in its
system prompt would change how it selects them and contaminate the numbers this
suite exists to produce. The judge already sees the prompt, every tool call and the
answer, so it gets the critique for free in a call we were making anyway.

Results land in `evals/capability/report.json` (stable filename), so the
before/after is a `git diff`. `EVAL_LABEL` suffixes it — `report.baseline.json`,
`report.current.json` — which is how the two halves of a surface comparison
avoid overwriting each other.

## Running

The harness is **provider-agnostic** — it uses whichever provider has credentials,
in this precedence: Azure → Anthropic → OpenAI. Set `EVAL_PROVIDER` to force one
(it throws rather than silently falling through to another, which would produce
numbers that don't mean what the reader thinks).

Add **one** of these to the repo `.env`:

```bash
# Anthropic — simplest for this repo
ANTHROPIC_API_KEY=...
# EVAL_MODEL_IDS=claude-opus-5,claude-haiku-4-5   # optional; defaults to claude-opus-5

# …or Azure — keeps scenario numbers comparable to the agent toolkit's suite,
# which runs the same default pair. A toolkit .env works unedited.
AZURE_RESOURCE_NAME=...
AZURE_API_KEY=...
# AZURE_MODEL_IDS=gpt-5.1,gpt-4.1     # optional; this pair is the default
# AZURE_API_VERSION=...               # optional

# …or OpenAI — EVAL_MODEL_IDS is REQUIRED (no default is shipped, since a guessed
# model id would 404 at run time and read as a harness bug).
OPENAI_API_KEY=...
EVAL_MODEL_IDS=...
```

Plus, for `capability/` only:

```bash
TOMTOM_API_KEY=...                    # real API calls, real quota
```

Optional across all providers:

```bash
EVAL_JUDGE_MODEL_ID=claude-opus-5     # judge model; defaults to the first model under test
SCENARIOS_FULL=1                      # fan out over every registry examplePrompt
EVAL_TRANSPORT=stdio                  # drive a real bin/tomtom-mcp.js instead of in-process tools
EVAL_SERVER_ROOT=../tomtom-mcp-baseline   # score ANOTHER checkout's server — see the comparison
EVAL_LABEL=baseline                   # names this run's artefacts (report.<label>.json)
```

Model-id defaults per provider live in `DEFAULT_MODEL_IDS` in `harness/model.ts`.
Anthropic deliberately defaults to Opus 5 **alone** rather than pairing it with a
cheaper model: adding a second is one env var, and picking a weaker default on
someone's behalf to save money is their call, not the harness's.

```bash
pnpm install                # picks up the `ai` + provider devDependencies
pnpm evals                  # tool selection, canonical set
pnpm evals:full             # SCENARIOS_FULL=1 — every registry examplePrompt
pnpm evals:capability       # the benchmark (real API calls, in-process tools)
pnpm evals:transport        # EVAL_TRANSPORT=stdio — everything over the real MCP wire
pnpm evals:all              # both suites
pnpm evals:baseline:setup   # build the pre-refactor checkout to compare against
pnpm evals:ab               # record both surfaces and write evals/comparison.md
pnpm type-check:evals       # evals are outside the root tsconfig's `src/**/*`
```

Without credentials every suite **skips** rather than fails, so this is safe to
wire into CI before the secrets exist.

> **Provider version pinning.** `ai@5` speaks provider spec v2, so the
> `@ai-sdk/*` providers must stay on their `2.x` line. Installing `@ai-sdk/anthropic@4`
> (built for AI SDK v6) fails to type-check with
> `Type 'BatchLanguageModelV4' is not assignable to type 'LanguageModelV2'`.
> Bump `ai` and all providers together, never one alone.

## Comparing against the previous tool surface

The suites normally score this working tree. `EVAL_SERVER_ROOT` points them at
another checkout instead — a git worktree parked on the commit before the tool
consolidation — so the **same corpus, the same judge and the same model** score
the old surface too. Nothing about the questions changes; only which server
answers them. That is the before/after.

It works because a baseline runs over the **real MCP transport**. The in-process
tool sources read `src/tools/tool-registry.ts` from *this* tree, which the old
tree does not have; the wire is surface-agnostic — a tool list, a JSON Schema
each, a text envelope back. So `EVAL_SERVER_ROOT` implies `EVAL_TRANSPORT=stdio`,
and the harness throws rather than quietly scoring this tree's tools under the
baseline's name.

```bash
pnpm evals:baseline:setup       # worktree at f530cc2^, installed and built
pnpm evals:ab                   # record baseline, record current, compare
```

`evals:ab` is the four recording runs plus the diff. Run them individually when
one half is already recorded:

```bash
pnpm evals:capability:baseline  # → evals/capability/report.baseline.json
pnpm evals:scenarios:baseline   # → evals/scenarios/runs.baseline.jsonl
pnpm evals:capability:current   # → evals/capability/report.current.json
pnpm evals:scenarios:current    # → evals/scenarios/runs.current.jsonl
pnpm evals:compare              # → evals/comparison.md
```

`EVAL_BASELINE_REF` moves the baseline commit and `EVAL_BASELINE_DIR` the
worktree path; `git worktree remove ../tomtom-mcp-baseline` cleans up.

### What is compared, and what is not

**Capability transfers unchanged.** A task asks a question and the judge scores
the answer, so it never mentions a tool name. Whichever surface answers more
tasks, grounded, for fewer tokens, wins on its own terms.

**Selection has to be translated.** A scenario asserts `tomtom-discover-places`,
which the old server never advertised — replaying it verbatim would score zero
and prove only that the tool was renamed. `harness/surfaces.ts` maps each current
tool to the legacy tools it absorbed (straight from the consolidation commit), and
a baseline scenario passes when the agent picked **any** of them. The question it
answers is the fair one: on the old surface, was the choice among the seven search
tools defensible for this prompt?

Two consequences worth knowing before reading the numbers:

- **`expectedArgs` and `inOrder` are dropped on a baseline.** They are written
  against today's schemas — a `where`/`poiCategories` predicate is meaningless
  against a tool that took a hand-built bounding box. What still counts is which
  tool and how many hops.
- **A prohibition can be dropped.** `nearby` vs `area-search` was a real near-miss
  to police on the old surface and both now live inside `discover-places`, so a
  scenario forbidding one while expecting the other is unsatisfiable after
  translation. It is dropped and recorded in `droppedForbidden` — that a
  distinction ceased to exist is a finding about the consolidation, not a bug.

**Two tools have no legacy counterpart at all** — `describe-dataset` and
`analyse-data`. Scenarios expecting them are recorded as
`unrepresentable` and left **out of the baseline's accuracy denominator**.
Counting them as baseline failures would manufacture an improvement out of a
tautology: of course the old server did not call a tool it did not have.

### Assertions are off for a baseline

A baseline run **records, never asserts**. The old surface fails the nine blocked
tasks by construction — that is why they are marked `blocked` — and a red run
would report the old server's known gaps as failures of this branch. Fabrication
is still detected and printed as a warning, because a baseline that fabricates is
the most interesting result the exercise can produce; it just does not fail the
build. `transport.test.ts` skips entirely, since every assertion in it compares
the wire to *this* registry.

### The halves have to match

`pnpm evals:compare` refuses to report a comparison whose two halves were not run
under the same conditions — a different model, or one half in-process and the
other over the wire. It writes `comparison.md` with a warning banner at the top
and then **exits non-zero**, because a gpt-4.1 baseline against a gpt-5.1 current
produces a table that looks exactly like a successful refactor. A report that
does not name its model at all is treated the same way: unverifiable, not
matching. `EVAL_ALLOW_MISMATCH=1` overrides it for a deliberate cross-model
comparison you will caveat wherever you quote it.

### Cost

Both halves hit the real TomTom API — that is unavoidable for capability, and for
selection it is the price of the baseline having no in-process tool source. The
current half is run over the transport too, because a mocked run and a live run
are not comparable to each other. Budget four model-driven runs over 13 tasks and
~15 canonical prompts.

### What the comparison will and will not settle

It settles whether the new surface answers more, in fewer hops, for fewer tokens,
without fabricating — the claims the consolidation was made on. It does not
settle anything about a **task the old surface answered and the new one does
not**: `evals/comparison.md` calls those out under **Lost**, and unless the task
is marked `expected: "pass"` the suite's own assertions will not catch it. Read
that line first.

### Not yet ported

`agent-eval/src/judge/groundingVerifier.ts` is the significant one. It replaces a
single `grounded: boolean` with a two-stage pipeline — extract every factual
claim, then verify each against the tool evidence one at a time — and its header
records a measured inter-rater kappa (0.72 verdict-first, against 0.61
reasoning-first). Its instructions already encode the corrections this repo
arrived at by hand: arithmetic and unit conversion are grounded, an entity the
USER named is not an invention, absence in present data is valid evidence.

Adopting it would change what `grounded` means, so it wants its own before/after
rather than being folded into an unrelated change.

Also unported, because nothing here drives them yet: the simulated-user runner
(`core/userAgent.ts`, `core/runner.ts`) and the multi-turn `Transcript`/`Turn`
stream. The MCP evals drive single turns.

## Relationship to the vendored mcp-builder harness

`.agents/skills/mcp-builder/` (pulled from `anthropics/skills`) ships its own LLM
eval harness: `scripts/evaluation.py` runs XML `<qa_pair>` questions against the
server over the real transport and checks a single verifiable answer. It is not
wired into any script or CI, and no TomTom question set exists for it — only the
skill's generic example.

The two overlap on "can a model answer with these tools", and the pieces worth
having from it — the real transport and the tool-definition critique — are now
folded in here (`EVAL_TRANSPORT=stdio` and `toolFriction`). What it still offers
that this does not is its format: one stable, independently verifiable answer per
question. That suits the four `lookup` tasks and does **not** suit the nine
`blocked` ones, which by definition have no answer yet. If you want that format
too, write a TomTom `evaluation.xml` for the stable-answer subset and run it with
`evaluation.py` — but note its default model (`claude-3-7-sonnet-20250219`) is
stale and should be overridden with `-m`.

## Known-hard cases under `SCENARIOS_FULL`

The canonical set is what CI should gate on. The broad fan-out additionally
surfaces a tail of prompts that depend on model behaviour the description can't
fully pin down — treat these as expected-flaky, not regressions:

- **Narrated instead of called** — a model replies "I'll look that up" without
  calling anything, despite the system prompt's explicit "act, don't narrate".
  The test correctly fails; it is a model limitation.
- **Chained one tool too many** — `poi-categories` before a search that did not
  need a category filter. Accepted via `acceptedAlternatives` where defensible.

If you are tightening descriptions, target the canonical set first.
