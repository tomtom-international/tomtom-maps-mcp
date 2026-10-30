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
 * result lives in a tool message, not in narrated text.
 */

import type { ModelMessage } from "ai";
import { getSharedSession } from "./session";

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
 * the real transport, a fixture that disagrees with what the server would have
 * returned sends the agent off to re-run the seeded call, and a one-hop follow-up
 * reads as a hop-count regression the server did not cause.
 *
 * So in a transport mode the seeded call is executed for real and its true
 * output is replayed. Mocked runs keep the canned value: there is no server to
 * ask, and nothing to be inconsistent with.
 *
 * A tool the target surface does not advertise falls back to the canned output —
 * a baseline replay seeds `tomtom-plan-route` history against a server that never
 * had it. That is why this returns a fallback instead of throwing.
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
