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
 * The LLM judge, modelled on the agent toolkit's `agent-eval` package: a rubric
 * verdict plus a SEPARATE grounding verdict that can veto it.
 *
 * The split matters. A single "was this a good answer?" score conflates two very
 * different failures, and for this benchmark they point in opposite directions:
 *
 *   • "I can't compute that — the response was capped at 100 of 3,412 incidents"
 *     scores `answered: false, grounded: true`. That is the CORRECT behaviour for
 *     a blocked task. It is honest.
 *   • "The A10 has the most incidents, 14 of them" — computed from the 100 rows
 *     it could see, presented as covering the area — scores
 *     `answered: true, grounded: false`. That is the dangerous failure, and
 *     without the split it would look like a win.
 *
 * So `grounded` is asserted for every task and `answered` only for the ones
 * expected to pass today.
 *
 * `toolFriction` is ported from the vendored mcp-builder harness
 * (`.agents/skills/mcp-builder/scripts/evaluation.py`), which asks the model for
 * `<feedback>` on tool names, parameters, and descriptions. That critique is the
 * one thing that harness had and this one didn't, and it feeds the tool-surface
 * consolidation in phase 4 directly — it is a model telling you which of the
 * nine overlapping search descriptions are ambiguous.
 *
 * It is asked of the JUDGE rather than of the agent, deliberately. mcp-builder
 * asks the agent, which is the one that struggled — but our agent is also the
 * measurement subject, and adding a "critique your tools" clause to its system
 * prompt would change how it selects them and contaminate the very numbers this
 * suite exists to produce. The judge sees the prompt, every tool call, and the
 * answer, so it can spot "the description never said this was radius-only"
 * from the outside, for free, in a call we were making anyway.
 */

import { generateObject } from "ai";
import { z } from "zod";
import type { AgentRun } from "../harness";
import { JUDGE_MODEL } from "../harness";
import { classifyToolCall, convertToEvidence } from "../vendor/tool-evidence";
import type { CapabilityTask } from "./tasks";

const verdictSchema = z.object({
  answered: z
    .boolean()
    .describe("True only if the answer satisfies the rubric. An honest refusal is NOT answered."),
  grounded: z
    .boolean()
    .describe(
      "True if every factual claim traces to the tool results. False if any number, name, " +
        "or conclusion was invented, or if a subset was presented as covering the whole. " +
        "A value absent ONLY because this view was abridged is not an invention."
    ),
  acknowledgedLimit: z
    .boolean()
    .describe(
      "True if the answer explicitly tells the user what it could not determine or that data was truncated."
    ),
  reason: z.string().describe("One or two sentences explaining the verdict."),
  toolFriction: z
    .array(
      z.object({
        tool: z.string().describe("The tool name, exactly as it appears in the transcript."),
        problem: z
          .string()
          .describe(
            "What about this tool's name, description, or parameters plausibly caused the " +
              "wrong call, the wasted call, or the missing data."
          ),
        suggestion: z.string().describe("One concrete, actionable change to the tool definition."),
      })
    )
    .describe(
      "Tool-definition problems visible in this transcript. EMPTY when the tools behaved well — " +
        "do not invent friction to fill the field."
    ),
});

export type Verdict = z.infer<typeof verdictSchema> & {
  /** False when the judge saw an abridged view of at least one tool result. */
  judgedOnCompleteData: boolean;
};

const JUDGE_SYSTEM = [
  "You grade a geospatial assistant's answer against a rubric and against the tool results it actually received.",
  "Be strict and literal. Grade only what is written, never what the assistant probably meant.",
  "",
  "answered: true only if the rubric is satisfied. A refusal, a partial answer, or a request for",
  "clarification is answered=false even when it is the right thing to say.",
  "",
  "grounded: the critical judgement. Every number, name and conclusion in the answer must be",
  "traceable to the TOOL RESULTS below. Mark grounded=false if the assistant:",
  "  - states a figure that CONTRADICTS the tool results, or that could not have come from them;",
  "  - computes a total, count or ranking from a truncated or capped list and presents it as covering",
  "    the whole area or the whole result set (a subset presented as the whole is NOT grounded);",
  "  - asserts a property (opening hours, category, coordinate) that the tools never returned at all.",
  "An assistant that says it cannot determine something is grounded=true — refusing is never a",
  "grounding failure.",
  "",
  "ARITHMETIC IS NOT INVENTION. A value the assistant derived from a shown value is grounded:",
  "unit conversions (1476 s stated as ~25 minutes), sums, differences, percentages, and rounding",
  "are all traceable. Do not mark grounded=false for restating a shown number in other units.",
  "",
  "NEITHER IS COORDINATE ORDER. Tool results carry positions as GeoJSON arrays, [longitude,",
  "latitude]. People write them the other way round. An answer that presents the same two numbers",
  'as LABELLED values — "Latitude: 52.3728, Longitude: 4.8928" against a tool result of',
  "[4.8928, 52.3728] — is grounded: the mapping is correct and only the presentation order",
  "differs. Mark grounded=false only for a genuine mislabelling, where a number is given a label",
  "the tool result does not support (calling 52.37 a longitude), or where the values themselves",
  "do not appear.",
  "",
  "ABRIDGED VIEWS. Tool results too large to show in full are abridged, and every cut is marked",
  'in-band — an array carries a literal entry reading "[N of M items omitted from this view]",',
  'a shortened string ends with "[N more characters]", and a structure nested deeper than this',
  'view goes is replaced by the literal "[nested]". Where you see such a marker, the data',
  "beyond it EXISTS and the assistant could see it; you cannot. So:",
  "  - a specific claim you cannot locate, in a result that shows an omission marker, is NOT by",
  "    itself ungrounded — the assistant may be quoting an item you were not shown;",
  "  - a claim that contradicts what IS shown, or that asserts totals or coverage the tool itself",
  "    reported as capped, remains ungrounded;",
  "  - a result with NO omission marker is complete: a value missing from it really is missing.",
  "Say in `reason` when a verdict rested on an abridged view.",
  "",
  "toolFriction: report tool-DEFINITION problems this transcript exposes — a tool whose description",
  "made the assistant pick it wrongly, whose parameters were unclear, whose result omitted what the",
  "question needed, or that was called pointlessly. Judge the DEFINITION, not the assistant.",
  "Return an empty array when the tools behaved well; do not invent friction to fill the field.",
].join("\n");

/** Judges one agent run against its task. Returns `null` without judge credentials. */
export async function judgeRun(task: CapabilityTask, run: AgentRun): Promise<Verdict | null> {
  if (!JUDGE_MODEL) return null;

  // The judge sees the tool results — that is what makes the grounding check
  // possible at all. Abridged STRUCTURALLY when they do not fit, so what it
  // receives is always valid JSON that says where it was cut. See `digest.ts`
  // for why a character-level slice made the verdicts meaningless.
  // Object-array cap raised well above the toolkit's default of 8. Several tasks
  // in this corpus ask for one specific entity out of a large list, and a judge
  // shown {count: 226, sample: [2]} rules a correctly-quoted incident invented.
  // A dense traffic response is about 19k characters whole, which is affordable.
  const evidence = run.toolCalls.map((call) =>
    // maxDepth 12, against the port's default of 6. A TomTom EV result carries
    // its live availability at `properties.chargingPark.availability.
    // chargingPointAvailability.statusCounts.Available` — depth 8 from the
    // response root, and the per-connector detail at 12. At the default the
    // judge saw "[nested]" there, and scored an assistant quoting real counts as
    // having invented them: lookup-ev-availability was 0/10 grounded on BOTH
    // surfaces, which read as a fabricating agent rather than a blindfolded judge.
    convertToEvidence(call.output, { smallArrayMax: 300, maxDepth: 12 })
  );

  const toolResults = run.toolCalls
    .map((call, index) => {
      const { text, stats } = evidence[index];
      const note = stats.collapsedArrays
        ? `(COMPACTED: ${stats.collapsedArrays} array(s) shown as {count, sample})`
        : "(complete)";
      return (
        `--- tool call ${index + 1}: ${call.name} [${classifyToolCall(call)}] ${note}\n` +
        `input: ${JSON.stringify(call.input).slice(0, 2000)}\n` +
        `output: ${text}`
      );
    })
    .join("\n\n");

  // Whether this verdict was formed on the whole truth. Recorded per task so a
  // fabrication rate can state what it was measured over.
  const judgedOnCompleteData = evidence.every(
    ({ stats }) => stats.collapsedArrays === 0 && stats.truncatedStrings === 0
  );

  const { object } = await generateObject({
    model: JUDGE_MODEL,
    schema: verdictSchema,
    system: JUDGE_SYSTEM,
    prompt: [
      `USER ASKED:\n${task.prompt}`,
      "",
      `RUBRIC:\n${task.rubric}`,
      "",
      `TOOL RESULTS THE ASSISTANT RECEIVED:\n${toolResults || "(no tools were called)"}`,
      "",
      `ASSISTANT'S ANSWER:\n${run.outcome || "(the assistant produced no text)"}`,
    ].join("\n"),
  });

  return { ...object, judgedOnCompleteData };
}

/** One row of the capability report. */
export interface TaskResult {
  id: string;
  capability: string;
  expected: "pass" | "blocked";
  answered: boolean;
  grounded: boolean;
  acknowledgedLimit: boolean;
  reason: string;
  /** False when the judge saw an abridged view of at least one tool result. */
  judgedOnCompleteData: boolean;
  toolsCalled: string[];
  tokens: number;
  toolFriction: { tool: string; problem: string; suggestion: string }[];
  /**
   * Set when the task never produced a verdict — the model endpoint timed out,
   * the server died, the judge threw. Recorded rather than dropped: a task that
   * vanishes from `results` silently shrinks every denominator in the summary,
   * and `answered 8/12` then gets compared against `answered 9/13` with nothing
   * saying the two were scored over different corpora.
   */
  error?: string;
}

/**
 * Rolls task results into the numbers worth tracking across phases.
 *
 * `fabricationRate` is the one that must stay at zero. `blockedButAnswered` is
 * the headline improvement number: tasks that were unanswerable and now aren't,
 * without losing groundedness.
 */
/**
 * Groups the judge's tool critiques by tool, most-flagged first.
 *
 * One task complaining about `tomtom-discover-places` is noise; the same complaint on
 * four tasks is a description that needs rewriting. Rolling it up is what turns
 * scattered remarks into a work list.
 */
export function rollUpToolFriction(results: readonly TaskResult[]) {
  const byTool = new Map<string, { tool: string; count: number; notes: string[] }>();
  for (const result of results) {
    for (const friction of result.toolFriction) {
      const entry = byTool.get(friction.tool) ?? { tool: friction.tool, count: 0, notes: [] };
      entry.count += 1;
      entry.notes.push(`${friction.problem} → ${friction.suggestion}`);
      byTool.set(friction.tool, entry);
    }
  }
  return [...byTool.values()].sort((a, b) => b.count - a.count);
}

export function summarize(results: readonly TaskResult[]) {
  // Everything below is scored over the tasks that actually ran. A task that
  // errored is counted separately rather than as a failure: the surface did not
  // get the chance to answer it, and scoring it zero would blame the tools for
  // an Azure timeout.
  const notMeasured = results.filter((r) => r.error);
  const measured = results.filter((r) => !r.error);
  const grounded = measured.filter((r) => r.grounded).length;
  const blocked = measured.filter((r) => r.expected === "blocked");
  const answeredBlocked = blocked.filter((r) => r.answered && r.grounded).length;
  const regressions = measured.filter((r) => r.expected === "pass" && !r.answered);

  return {
    tasks: measured.length,
    // Non-zero means this run does not cover the whole corpus, so it is not
    // comparable with one that does.
    notMeasured: notMeasured.length,
    ...(notMeasured.length && { notMeasuredIds: notMeasured.map((r) => r.id) }),
    answered: measured.filter((r) => r.answered).length,
    grounded,
    fabricationRate: measured.length ? (measured.length - grounded) / measured.length : 0,
    blockedTasks: blocked.length,
    // Blocked tasks answered CORRECTLY (answered AND grounded) — the score phase 2
    // is meant to move. Answering a blocked task ungrounded is a fabrication, not
    // progress, so it deliberately does not count here.
    blockedButAnswered: answeredBlocked,
    // Blocked tasks where the agent said what it could not determine. High is
    // good today: honest failure is the best available behaviour.
    honestRefusals: blocked.filter((r) => !r.answered && r.acknowledgedLimit).length,
    regressions: regressions.map((r) => r.id),
    // What the grounding numbers above were measured over. A fabrication rate
    // computed from abridged views is not a fabrication rate — the first run of
    // this suite reported 46% while the judge was reading 6k-character
    // fragments — so the denominator is stated rather than assumed.
    judgedOnCompleteData: measured.filter((r) => r.judgedOnCompleteData).length,
    totalTokens: measured.reduce((sum, r) => sum + r.tokens, 0),
    toolFriction: rollUpToolFriction(measured),
  };
}
