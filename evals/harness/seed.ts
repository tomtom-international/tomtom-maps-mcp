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
 * Prior-turn staging, ported from the agent toolkit's
 * `testing/agent-tool-calling/src/seed.ts`.
 *
 * Instead of narrating loaded state in crafted assistant prose, these helpers
 * replay a completed turn the way it actually appears in the model's history: an
 * assistant tool-CALL message, the matching tool-RESULT message, then a short
 * summary. The agent under test then sees realistic mid-session state — a
 * `dataset_id` lives in a tool result, not in narrated text.
 */

import type { ModelMessage } from "ai";
import { getSharedSession } from "./session";
import { TARGET } from "./target";

/** One staged tool invocation: the call the assistant made plus what it observed. */
export interface SeededToolCall {
  tool: string;
  input: Record<string, unknown>;
  output: unknown;
}

/** Convenience constructor for a {@link SeededToolCall}. */
export const toolCall = (
  tool: string,
  input: Record<string, unknown>,
  output: unknown
): SeededToolCall => ({ tool, input, output });

/**
 * Replays a completed prior turn as message history: the user request, the
 * assistant's tool-call message, the matching tool-result message, and a short
 * natural-language summary.
 */
export const priorTurn = (
  request: string,
  calls: SeededToolCall[],
  summary: string
): ModelMessage[] => [
  { role: "user", content: request },
  {
    role: "assistant",
    content: calls.map((call, index) => ({
      type: "tool-call" as const,
      toolCallId: `seed-${index}`,
      toolName: call.tool,
      input: call.input,
    })),
  },
  {
    role: "tool",
    content: calls.map((call, index) => ({
      type: "tool-result" as const,
      toolCallId: `seed-${index}`,
      toolName: call.tool,
      output: { type: "json" as const, value: call.output as never },
    })),
  },
  { role: "assistant", content: summary },
];

/**
 * A prior turn whose tool result is REAL.
 *
 * Canned seed output is fine while the tools are mocked — nothing checks it. Over
 * the real transport it is a trap, and the A/B walked straight into it: the
 * fixture claimed `dataset_id: "ds_routefixture"`, the live server had never
 * heard of it, and `tomtom-get-traffic` replied
 *
 *   Dataset "ds_routefixture" is not available (datasets live 30 minutes).
 *   Re-run the tool that produced it, or name the area with `queries` instead.
 *
 * The agent then did exactly as told — re-planned the route, retried — turning a
 * one-hop follow-up into three and reading as a hop-count REGRESSION against a
 * baseline whose tools never took dataset ids at all. The agent was right and the
 * fixture was wrong, which is the worst way round for a benchmark.
 *
 * So in a transport mode the seeded call is executed for real and its true
 * output is replayed, dataset id and all. Mocked runs keep the canned value:
 * there is no server to ask, and nothing to be inconsistent with.
 *
 * A tool the target surface does not advertise falls back to the canned output —
 * a baseline replay seeds `tomtom-plan-route` history against a server that never
 * had it. Harmless, since the legacy tools take coordinates rather than dataset
 * handles, but it is why this returns a fallback instead of throwing.
 */
export const liveSeed = (
  request: string,
  call: SeededToolCall,
  summary: string
): (() => Promise<ModelMessage[]>) => {
  return async () => {
    if (process.env.EVAL_TRANSPORT !== "stdio") {
      return priorTurn(request, [call], summary);
    }

    const session = await getSharedSession();
    if (!session.toolNames.includes(call.tool)) {
      return priorTurn(request, [call], summary);
    }

    const tools = session.buildTools([]);
    try {
      const output = await tools[call.tool].execute?.(call.input, {
        toolCallId: `seed-live-${call.tool}`,
        messages: [],
      });
      return priorTurn(request, [{ ...call, output }], summary);
    } catch {
      // A seed that cannot run must not fail the scenario it is only staging.
      // The canned value still describes the same situation, just less exactly.
      return priorTurn(request, [call], summary);
    }
  };
};

/** True when seeds will be executed for real — useful in diagnostics. */
export const seedsAreLive = (): boolean =>
  process.env.EVAL_TRANSPORT === "stdio" && TARGET.surface === "consolidated";
