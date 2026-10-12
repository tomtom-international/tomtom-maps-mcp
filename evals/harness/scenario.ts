/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Tool-selection scenario runner.
 *
 * Same API as the agent toolkit's `testing/agent-tool-calling/src/scenario.ts` —
 * `createToolScenarioRunner`, `expectAnyToolCalled`, `expectNoneOfToolsCalled`,
 * `expectToolCalledInOrder`, `expectToolCallCount`, `FULL_SCENARIOS`, and the
 * `ScenarioOutcome` shape asserted at the test level — so a scenario file reads
 * the same on both sides.
 *
 * The assertions run against the recorded tool calls rather than
 * `@langwatch/scenario`'s `state.hasToolCall`, because the agent under test here
 * is a plain AI SDK tool loop (see `mcp-agent.ts`) rather than a stateful map
 * agent. The semantics are identical; the multi-turn user simulator is not
 * needed for selection, and the capability benchmark drives its own turns.
 */

import type { LanguageModel, ModelMessage } from "ai";
import { totalTokens } from "../vendor/types";
import { type AgentRun, runAgent, type ToolMode } from "./mcp-agent";
import { MODELS } from "./model";
import { recordScenario } from "./scenario-log";
import { getSharedSession } from "./session";
import { type TranslatedExpectation, toLegacyExpectation } from "./surfaces";
import { assertTransportForTarget, TARGET } from "./target";

// Gates the broad `examplePrompts` fanout (`it.skipIf(!FULL_SCENARIOS).each(...)`).
// Default = off, so the canonical smoke set runs; `SCENARIOS_FULL=1` fans out
// across every registry prompt.
export const FULL_SCENARIOS = process.env.SCENARIOS_FULL === "1";

/**
 * How scenario tools are wired, unless a scenario says otherwise.
 *
 * `mocked` by default — selection is about which tool the model reaches for, and
 * a canned result answers that for free. `EVAL_TRANSPORT=stdio` switches to the
 * real server, which costs TomTom quota; it exists because a BASELINE run has no
 * other option (the in-process source reads this checkout's registry), and
 * because a baseline is only comparable to a current run wired the same way.
 */
const DEFAULT_SCENARIO_MODE: ToolMode = process.env.EVAL_TRANSPORT === "stdio" ? "stdio" : "mocked";

/** Outcome of a scenario run, shaped so the test asserts at the top level. */
export interface ScenarioOutcome {
  success: boolean;
  failureReason: string;
  run?: AgentRun;
  /**
   * Set when the scenario could not be evaluated against the target surface at
   * all — it names a tool that surface never had. Reported as a pass so a
   * baseline replay is not red with tautologies, and excluded from the recorded
   * accuracy so it cannot be mistaken for one either.
   */
  skipped?: string;
}

/** Human-readable failure summary: what the agent called, and what it said. */
export const formatScenarioFailure = (run: AgentRun, problem: string): string => {
  const called = run.toolCalls.map((call) => call.name);
  const lines = [
    problem,
    `tools called: [${called.join(", ") || "none"}]`,
    run.outcome.trim() ? `agent said: "${run.outcome.trim().slice(0, 300)}"` : "agent said nothing",
  ];
  return `\n  ${lines.join("\n  ")}\n`;
};

const namesOf = (run: AgentRun): string[] => run.toolCalls.map((call) => call.name);

/** Passes if ANY ONE of the named tools was called (logical OR). */
export const expectAnyToolCalled = (run: AgentRun, ...toolNames: string[]): string | undefined =>
  toolNames.some((name) => namesOf(run).includes(name))
    ? undefined
    : `Expected one of [${toolNames.join(", ")}] to be called.`;

/** Passes if NONE of the named tools was called. */
export const expectNoneOfToolsCalled = (
  run: AgentRun,
  ...toolNames: string[]
): string | undefined => {
  const called = toolNames.find((name) => namesOf(run).includes(name));
  return called ? `Tool ${called} was called but should not have been.` : undefined;
};

/**
 * Asserts the named tools were called in order, each strictly after the previous
 * one. Proves a genuinely sequential flow (categories → search) rather than a
 * parallel batch.
 */
export const expectToolCalledInOrder = (
  run: AgentRun,
  ...toolNames: string[]
): string | undefined => {
  const called = namesOf(run);
  let cursor = -1;
  for (const name of toolNames) {
    const index = called.findIndex((actual, position) => position > cursor && actual === name);
    if (index === -1) {
      return (
        `Expected tool-call order [${toolNames.join(" → ")}], but "${name}" was not called ` +
        `after position ${cursor} (${called.length} calls total).`
      );
    }
    cursor = index;
  }
  return undefined;
};

/** Exact invocation count for one tool. */
export const expectToolCallCount = (
  run: AgentRun,
  toolName: string,
  expectedCount: number
): string | undefined => {
  const actual = namesOf(run).filter((name) => name === toolName).length;
  return actual === expectedCount
    ? undefined
    : `Expected ${toolName} to be called ${expectedCount} time(s), but it was called ${actual}.`;
};

/**
 * A predicate over one tool call's arguments.
 *
 * Return `true` to accept, `false` to reject, or a **string** to reject with your
 * own reason — the string is far more useful in a failure message than a bare
 * `false`, which only tells you that something about the arguments was wrong.
 */
// biome-ignore lint/suspicious/noExplicitAny: the tool boundary is untyped by
// design — inputs are whatever the model produced. `any` here is what lets a
// scenario write `(input) => input.where?.queries?.[0]?.query === "Amsterdam"`
// without a cast on every hop. Callers wanting types pass an explicit `T`.
export type ToolInputPredicate<T = any> = (input: T) => boolean | string;

/**
 * Asserts a tool was called with arguments matching `predicate`.
 *
 * Why this exists: every other assertion here checks *which* tool was called,
 * which is the right question while the surface is one tool per endpoint. It
 * stops being the right question as tools get wider — once one `discoverPlaces`
 * absorbs seven search tools, "was discoverPlaces called?" is trivially true and
 * measures nothing, while the real failure mode is a correctly-chosen tool called
 * with the search SUBJECT in the `where` scope ("restaurants") instead of the
 * region ("Amsterdam"). This is the assertion that catches that.
 *
 * Semantics: passes when **any** call to `toolName` satisfies the predicate,
 * matching the OR semantics of `expectAnyToolCalled` — an agent may legitimately
 * search several times, and one correct call is a correct routing. Use
 * {@link expectEveryToolCallWith} when every call must hold.
 *
 * The failure message always includes the arguments actually passed. Without them
 * a failure tells you nothing you can act on.
 */
export const expectToolCalledWith = <T = unknown>(
  run: AgentRun,
  toolName: string,
  predicate: ToolInputPredicate<T>
): string | undefined => {
  const calls = run.toolCalls.filter((call) => call.name === toolName);
  if (calls.length === 0) {
    return `Expected ${toolName} to be called with matching arguments, but it was never called.`;
  }

  const reasons: string[] = [];
  for (const call of calls) {
    const verdict = predicate(call.input as T);
    if (verdict === true) return undefined;
    reasons.push(typeof verdict === "string" ? verdict : "arguments did not match");
  }

  return (
    `${toolName} was called ${calls.length} time(s), none with matching arguments:\n` +
    calls
      .map((call, index) => `    [${index}] ${reasons[index]} — got ${describeInput(call.input)}`)
      .join("\n")
  );
};

/**
 * Like {@link expectToolCalledWith}, but EVERY call to the tool must match.
 *
 * Use for invariants rather than intent — e.g. "no search ever asked for more
 * than 100 results", or "every route request carried at least two locations".
 */
export const expectEveryToolCallWith = <T = unknown>(
  run: AgentRun,
  toolName: string,
  predicate: ToolInputPredicate<T>
): string | undefined => {
  const calls = run.toolCalls.filter((call) => call.name === toolName);
  if (calls.length === 0) {
    return `Expected every ${toolName} call to match, but it was never called.`;
  }

  for (const [index, call] of calls.entries()) {
    const verdict = predicate(call.input as T);
    if (verdict === true) continue;
    const reason = typeof verdict === "string" ? verdict : "arguments did not match";
    return `${toolName} call [${index}] did not match: ${reason} — got ${describeInput(call.input)}`;
  }
  return undefined;
};

/**
 * Serialises a tool input for a failure message, truncated so one fat GeoJSON
 * argument can't bury the rest of the diagnostic.
 */
const describeInput = (input: unknown): string => {
  try {
    const json = JSON.stringify(input);
    return json.length > 400 ? `${json.slice(0, 400)}…` : json;
  } catch {
    return String(input);
  }
};

/**
 * One classification scenario: a user `prompt` plus what counts as routing it
 * correctly. Passes when the agent calls `expectedTool` (or any
 * `acceptedAlternatives`) and none of `forbiddenTools`.
 */
export interface ToolScenarioOptions {
  expectedTool: string;
  prompt: string;
  acceptedAlternatives?: readonly string[];
  forbiddenTools?: readonly string[];
  /**
   * Message history staging mid-session state — build with `priorTurn`, or with
   * `liveSeed` when the staged state must survive contact with a real server
   * (a `dataset_id` the next tool call will actually resolve).
   */
  priorTurns?: () => ModelMessage[] | Promise<ModelMessage[]>;
  /** Tools that must ALL be called, each after the previous. */
  inOrder?: readonly string[];
  /**
   * Argument-shape assertions, keyed by tool name — `{ "tomtom-discover-places":
   * (input) => !!input.poiCategories?.length }`. Each runs via
   * {@link expectToolCalledWith}, so it passes when ANY call to that tool matches.
   *
   * Use this once a tool is wide enough that "it was called" stops being
   * evidence: it is the difference between "routed to the search tool" and
   * "routed to the search tool with the region in `where` and the subject in
   * `poiCategories`".
   */
  expectedArgs?: Readonly<Record<string, ToolInputPredicate>>;
  /**
   * Accepts ZERO tool calls as a correct outcome, with the reason why.
   *
   * Normally silence is a failure — the system prompt says act, don't narrate.
   * But once prior turns carry the answer, the right number of calls is none,
   * and a scenario that insists on one is demanding a wasted hop. Set this only
   * where the staged history genuinely contains the answer, and say what it is;
   * `forbiddenTools` still applies, so "answer from context OR refresh, but never
   * via this tool" stays expressible.
   */
  acceptNoToolCall?: string;
  /** Defaults to `mocked`; selection scenarios should never need `live`. */
  mode?: ToolMode;
}

/**
 * Binds a model list into a ready-to-use `runToolScenario`.
 *
 * Every scenario runs once per configured model ({@link MODELS}) and only passes
 * when ALL of them route correctly, so a prompt that works on one model can't
 * silently regress on another. The failure message names which model(s) failed
 * and what each called.
 */
// Runs each `expectedArgs` predicate and returns the first failure, so the
// scenario reports one actionable problem rather than a wall of them.
const firstArgProblem = (
  run: AgentRun,
  expectedArgs: ToolScenarioOptions["expectedArgs"]
): string | undefined => {
  for (const [toolName, predicate] of Object.entries(expectedArgs ?? {})) {
    const problem = expectToolCalledWith(run, toolName, predicate);
    if (problem) return problem;
  }
  return undefined;
};

/**
 * The expectation as it will actually be evaluated.
 *
 * On a consolidated surface that is the expectation as written. On the `legacy`
 * surface it is rewritten onto the tool names that server really advertises, so
 * a scenario asserting `tomtom-discover-places` is scored on whether the old
 * agent reached for any of the seven tools that became it — the question worth
 * asking — rather than on a name that did not exist yet.
 */
const resolveExpectation = (options: {
  expectedTool: string;
  acceptedAlternatives: readonly string[];
  forbiddenTools: readonly string[];
}): { accepted: string[]; banned: string[]; legacy?: TranslatedExpectation } => {
  if (TARGET.surface === "consolidated") {
    return {
      accepted: [options.expectedTool, ...options.acceptedAlternatives],
      banned: [...options.forbiddenTools],
    };
  }
  const legacy = toLegacyExpectation(options);
  return { accepted: legacy.accepted, banned: legacy.forbidden, legacy };
};

/**
 * Records — and passes — a scenario the target surface cannot express.
 *
 * Reported as a pass so a baseline replay is not red with tautologies (the old
 * server did not call a tool it never had), and flagged in the log so it is
 * excluded from accuracy rather than counted as one. Both halves matter: a
 * silent failure here would invent an improvement, a silent pass would hide one.
 */
const skipUnrepresentable = (
  prompt: string,
  expectedTool: string,
  unrepresentable: string[]
): ScenarioOutcome => {
  const reason = `[${TARGET.label}] not evaluated: ${unrepresentable.join(", ")} not on this tool surface`;
  console.warn(`  ⊘ ${reason} — "${prompt}"`);
  recordScenario({
    label: TARGET.label,
    serverRoot: TARGET.root,
    prompt,
    expectedTool,
    accepted: [],
    forbidden: [],
    unrepresentable,
    modelId: "",
    toolsCalled: [],
    hops: 0,
    passed: true,
    tokens: 0,
  });
  return { success: true, failureReason: "", skipped: reason };
};

export const createToolScenarioRunner =
  (models: readonly { id: string; model: LanguageModel }[] = MODELS) =>
  async ({
    expectedTool,
    prompt,
    acceptedAlternatives = [],
    forbiddenTools = [],
    priorTurns,
    inOrder,
    expectedArgs,
    acceptNoToolCall,
    mode = DEFAULT_SCENARIO_MODE,
  }: ToolScenarioOptions): Promise<ScenarioOutcome> => {
    assertTransportForTarget(process.env.EVAL_TRANSPORT);

    const { accepted, banned, legacy } = resolveExpectation({
      expectedTool,
      acceptedAlternatives,
      forbiddenTools,
    });

    const session = mode === "stdio" ? await getSharedSession() : undefined;

    // A scenario only means something if the target advertises a tool that could
    // satisfy it. The legacy map answers that for the pre-consolidation surface;
    // for everything else the SERVER answers it, by way of what it listed.
    //
    // This matters for a phase series rather than a two-way A/B: phases 1 and 2
    // speak the consolidated vocabulary but carry no dataset tools, so a
    // registry-derived scenario expecting `tomtom-analyse-data` would be scored
    // as a routing failure on a surface where the tool does not exist — the same
    // tautology the legacy path already refuses to count.
    const advertised = session?.toolNames;
    const reachable = advertised ? accepted.filter((name) => advertised.includes(name)) : accepted;

    if (reachable.length === 0) {
      const missing = legacy?.unrepresentable.length
        ? legacy.unrepresentable
        : [expectedTool, ...acceptedAlternatives];
      return skipUnrepresentable(prompt, expectedTool, missing);
    }

    // `inOrder` and `expectedArgs` are written against the current schemas — a
    // `where`/`poiCategories` predicate cannot be evaluated against a tool that
    // took a hand-built bounding box. Dropping them on a baseline keeps what
    // remains (which tool, how many hops) honest rather than uniformly failing.
    const orderedTools = legacy ? undefined : inOrder;
    const argChecks = legacy ? undefined : expectedArgs;
    // Staged once, not per model: a live seed issues a real tool call, and each
    // model must see the same history for their results to be comparable.
    const staged = (await priorTurns?.()) ?? [];
    const failures: string[] = [];
    let lastRun: AgentRun | undefined;

    for (const { id, model } of models) {
      const run = await runAgent({
        model,
        mode,
        session,
        messages: [...staged, { role: "user", content: prompt }],
      });
      lastRun = run;

      // Zero calls, where the staged history already holds the answer, is the
      // best possible outcome rather than a missing one.
      const answeredFromContext = acceptNoToolCall !== undefined && run.toolCalls.length === 0;

      const problem = answeredFromContext
        ? undefined
        : (expectAnyToolCalled(run, ...reachable) ??
          (orderedTools?.length ? expectToolCalledInOrder(run, ...orderedTools) : undefined) ??
          (banned.length ? expectNoneOfToolsCalled(run, ...banned) : undefined) ??
          (argChecks ? firstArgProblem(run, argChecks) : undefined));

      if (problem) failures.push(`  ✗ [${id}]${formatScenarioFailure(run, problem)}`);

      recordScenario({
        label: TARGET.label,
        serverRoot: TARGET.root,
        prompt,
        expectedTool,
        accepted: reachable,
        forbidden: banned,
        droppedForbidden: legacy?.droppedForbidden,
        modelId: id,
        toolsCalled: run.toolCalls.map((call) => call.name),
        hops: run.toolCalls.length,
        passed: !problem,
        problem,
        tokens: totalTokens(run.usage),
      });
    }

    return {
      success: failures.length === 0,
      failureReason: failures.join("\n"),
      run: lastRun,
    };
  };
